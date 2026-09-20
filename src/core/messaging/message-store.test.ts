import { InMemoryMessageStore } from './message-store';
import { StoreBackedSession } from './store-backed-session';
import {
  flushWrites,
  STORE_TEST_PEER as THEM,
  STORE_TEST_SELF as ME,
  StoreBackedTestTransport,
  storeBackedSession as sessionOn,
} from './testing/store';

describe('history across a restart', () => {
  it('gives a new session what the old one received', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1000, 'said before the restart');
    const conversation = first.transport.conversationIdFor([ME, THEM]);
    await flushWrites();

    const second = await sessionOn(store);

    const messages = await second.session.getMessages(conversation);
    expect(messages.map((m) => (m.content as { text: string }).text)).toEqual([
      'said before the restart',
    ]);
  });

  it('lists the conversation again without waiting for the network', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1000, 'hello');
    await flushWrites();

    const second = await sessionOn(store);

    const conversations = await second.session.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].lastMessage?.id).toBe('m1');
  });

  it('reopens restored conversations on the transport', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1000, 'hello');
    await flushWrites();

    const second = await sessionOn(store);
    expect(second.transport.opened).toEqual([`topic:${[ME, THEM].sort().join('+')}`]);
  });

  it('does not resurrect a conversation that was left', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1000, 'hello');
    await flushWrites();
    const id = first.transport.conversationIdFor([ME, THEM]);
    await first.session.leaveGroup(id);

    const second = await sessionOn(store);
    expect(await second.session.listConversations()).toEqual([]);
    expect(await second.session.getMessages(id)).toHaveLength(1);
  });

  it('keeps a sent message, not just a received one', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    const conversation = await first.session.createDm(THEM);
    await first.session.send(conversation.id, { kind: 'text', text: 'mine' });
    await flushWrites();

    const second = await sessionOn(store);
    expect(await second.session.getMessages(conversation.id)).toHaveLength(1);
  });

});

describe('dedupe', () => {
  it('ignores the same message arriving twice', async () => {
    const store = new InMemoryMessageStore();
    const { session, transport } = await sessionOn(store);

    await transport.receive('m1', 1000, 'once');
    await transport.receive('m1', 1000, 'once');
    await flushWrites();

    expect(await session.getMessages(transport.conversationIdFor([ME, THEM]))).toHaveLength(1);
  });

  it('does not replay history as new messages on the next launch', async () => {
    const store = new InMemoryMessageStore();

    const first = await sessionOn(store);
    await first.transport.receive('m1', 1000, 'hello');
    await flushWrites();

    const second = await sessionOn(store);
    const seen: string[] = [];
    await second.session.streamMessages((m) => seen.push(m.id));

    await second.transport.receive('m1', 1000, 'hello');
    await flushWrites();

    expect(seen).toEqual([]);
  });
});

describe('durable writes', () => {
  it('reports a failed write and accepts the same event when redelivered', async () => {
    class FlakyStore extends InMemoryMessageStore {
      attempts = 0;
      override async insertMessage(
        message: Parameters<InMemoryMessageStore['insertMessage']>[0],
        conversation?: Parameters<InMemoryMessageStore['insertMessage']>[1],
      ) {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error('disk full');
        return super.insertMessage(message, conversation);
      }
    }
    const store = new FlakyStore();
    const { session, transport } = await sessionOn(store);
    const seen: string[] = [];
    await session.streamMessages((message) => seen.push(message.id));
    let history: import('./history').HistoryState = { status: 'idle' };
    session.subscribeHistory((state) => { history = state; });

    await expect(transport.receive('m1', 1000, 'keep me')).rejects.toThrow('disk full');
    expect(history).toEqual({
      status: 'error',
      error: 'Could not save message history: disk full',
    });
    expect(seen).toEqual([]);

    await transport.receive('m1', 1000, 'keep me');
    expect(history).toEqual({ status: 'idle' });
    expect(seen).toEqual(['m1']);
    expect(await store.loadMessages(transport.conversationIdFor([ME, THEM]))).toHaveLength(1);
  });

  it('stops intake before waiting for queued writes during disconnect', async () => {
    let release!: () => void;
    class SlowStore extends InMemoryMessageStore {
      override async insertMessage(
        message: Parameters<InMemoryMessageStore['insertMessage']>[0],
        conversation?: Parameters<InMemoryMessageStore['insertMessage']>[1],
      ) {
        await new Promise<void>((resolve) => { release = resolve; });
        return super.insertMessage(message, conversation);
      }
    }
    const { session, transport } = await sessionOn(new SlowStore());
    const receiving = transport.receive('m1', 1000, 'keep me');
    const disconnecting = session.disconnect();
    await flushWrites();
    expect(transport.disconnected).toBe(true);
    await transport.receive('late', 2000, 'drop me');
    release();
    await receiving;
    await disconnecting;
    expect(transport.disconnected).toBe(true);
    expect(await session.getMessages(transport.conversationIdFor([ME, THEM]))).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('loads stored messages older than the hydration limit', async () => {
    class CountingStore extends InMemoryMessageStore {
      loads = 0;
      override async loadMessages(...args: Parameters<InMemoryMessageStore['loadMessages']>) {
        this.loads += 1;
        return super.loadMessages(...args);
      }
    }
    const store = new CountingStore();
    const transport = new StoreBackedTestTransport();
    const id = transport.conversationIdFor([ME, THEM]);
    await store.upsertConversation({
      id,
      protocolId: transport.protocolId,
      participants: [ME, THEM],
      createdAt: 1,
      hidden: false,
    });
    for (let index = 1; index <= 600; index++) {
      await store.insertMessage({
        id: `m${String(index).padStart(3, '0')}`,
        conversationId: id,
        senderId: THEM,
        sentAt: index,
        content: { kind: 'text', text: String(index) },
        fromMe: false,
        status: 'sent',
      });
    }

    const session = new StoreBackedSession(transport, store);
    transport.attach(session);
    await session.hydrate();
    expect(store.loads).toBe(0);
    const hydrated = await session.getMessages(id);
    expect(hydrated).toHaveLength(500);
    const older = await session.getMessages(id, { limit: 100, before: hydrated[0] });
    expect(older).toHaveLength(100);
    expect(older[0].id).toBe('m001');
  });
});
