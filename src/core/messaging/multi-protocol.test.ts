import AsyncStorage from '@react-native-async-storage/async-storage';

import { botConversationId, type Bot } from './bots';
import { useChatStore, xmtpSessionFor } from './chat-store';
import { InMemoryChatSession } from './in-memory-session';
import { connectFake, disconnectFake, ns, resetChatStore } from './testing/store';

jest.mock('../identity/keyring', () => ({
  ...jest.requireActual('../identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

const XMTP_SELF = 'a'.repeat(64);
const NOSTR_SELF = 'b'.repeat(64);

function twoTransports() {
  const xmtp = new InMemoryChatSession({ participantId: XMTP_SELF });
  const nostr = new InMemoryChatSession({ participantId: NOSTR_SELF });
  return {
    xmtp,
    nostr,
    connect: () =>
      connectFake(xmtp, {
        protocols: ['xmtp', 'nostr'],
        sessionFor: (id) => (id === 'xmtp' ? xmtp : nostr),
      }),
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
});

describe('the merged list', () => {
  it('shows conversations from every connected transport, attributed', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    xmtp.seedConversation({ id: 'c1', title: 'Alice', createdAt: 1_000 });
    nostr.seedConversation({ id: 'c1', title: 'Bob', createdAt: 2_000 });

    await connect();

    const conversations = useChatStore.getState().conversations;
    expect(
      conversations
        .filter((c) => c.protocol !== 'local')
        .map((c) => c.id)
        .sort()
    ).toEqual([ns('c1'), ns('c1', 'nostr')].sort());
    expect(conversations.find((c) => c.protocol === 'nostr')?.title).toBe('Bob');
    expect(conversations.find((c) => c.protocol === 'xmtp')?.title).toBe('Alice');
  });

  it('interleaves by recency, not by protocol', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    xmtp.seedConversation({ id: 'older', createdAt: 1_000 });
    nostr.seedConversation({ id: 'newer', createdAt: 5_000 });
    await connect();

    expect(
      useChatStore
        .getState()
        .conversations.filter((c) => c.protocol !== 'local')
        .map((c) => c.id)
    ).toEqual([ns('newer', 'nostr'), ns('older')]);
  });

  it('keeps local bot conversations alongside both', async () => {
    const bot: Bot = {
      id: 'status',
      name: 'Status',
      tagline: 'on-device',
      greeting: () => ['hi'],
    };
    const { xmtp, connect } = twoTransports();
    xmtp.seedConversation({ id: 'c1' });

    await connect();
    await useChatStore.getState().registerBots([bot]);

    const ids = useChatStore.getState().conversations.map((c) => c.id);
    expect(ids).toContain(botConversationId('status'));
    expect(ids).toContain(ns('c1'));
    expect(
      useChatStore.getState().conversations.find((c) => c.id === botConversationId('status'))
        ?.protocol
    ).toBe('local');
  });
});

describe('routing by id', () => {
  it('sends down the transport the conversation belongs to', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    xmtp.seedConversation({ id: 'x1' });
    nostr.seedConversation({ id: 'n1' });
    await connect();

    await useChatStore.getState().sendMessage(ns('x1'), { kind: 'text', text: 'to xmtp' });
    await useChatStore
      .getState()
      .sendMessage(ns('n1', 'nostr'), { kind: 'text', text: 'to nostr' });

    expect(xmtp.sent).toEqual([
      { conversationId: 'x1', content: { kind: 'text', text: 'to xmtp' } },
    ]);
    expect(nostr.sent).toEqual([
      { conversationId: 'n1', content: { kind: 'text', text: 'to nostr' } },
    ]);
  });

  it('routes membership calls the same way', async () => {
    const { nostr, connect } = twoTransports();
    await connect();

    const group = await useChatStore.getState().startGroup('nostr', ['c'.repeat(64)], 'Trio');
    expect(group.protocol).toBe('nostr');

    await useChatStore.getState().leaveGroup(group.id);
    expect(nostr.left).toEqual(['group-Trio']);
  });

  it('names the protocol when it is not connected, rather than "not connected"', async () => {
    const { connect } = twoTransports();
    await connect();

    await expect(useChatStore.getState().getMembers('waku-abc')).rejects.toThrow(
      /waku is not connected/
    );
  });

  it('refuses an id from before namespacing rather than guessing a transport', async () => {
    const { connect } = twoTransports();
    await connect();

    await expect(useChatStore.getState().getMembers('a'.repeat(64))).rejects.toThrow(
      /Not connected/
    );
  });
});

describe('independent failure', () => {
  it('keeps working when one transport cannot connect', async () => {
    const xmtp = new InMemoryChatSession({ participantId: XMTP_SELF });
    xmtp.seedConversation({ id: 'c1' });

    await connectFake(xmtp, {
      protocols: ['xmtp', 'nostr'],
      sessionFor: (id) => {
        if (id === 'nostr') throw new Error('every relay refused');
        return xmtp;
      },
    });

    const state = useChatStore.getState();
    expect(state.status).toBe('ready');
    expect(state.protocols.xmtp).toEqual({
      status: 'ready',
      error: null,
      history: { status: 'idle' },
    });
    expect(state.protocols.nostr.status).toBe('error');
    expect(state.protocols.nostr.error).toBe('every relay refused');
    expect(state.conversations.filter((c) => c.protocol !== 'local').map((c) => c.id)).toEqual([
      ns('c1'),
    ]);
  });

  it('reports error only when every transport failed', async () => {
    await connectFake(new InMemoryChatSession(), {
      protocols: ['xmtp', 'nostr'],
      sessionFor: () => {
        throw new Error('nothing works');
      },
    });

    expect(useChatStore.getState().status).toBe('error');
    expect(useChatStore.getState().error).toBe('nothing works');
  });

  it('does not let one transport failing to list blank the others', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    xmtp.seedConversation({ id: 'c1' });
    nostr.seedConversation({ id: 'c2' });
    await connect();

    jest.spyOn(nostr, 'listConversations').mockRejectedValueOnce(new Error('relay timeout'));
    await useChatStore.getState().refreshConversations();

    expect(useChatStore.getState().conversations.map((c) => c.id)).toContain(ns('c1'));
  });

  it('does not let one transport failing to sync break pull-to-refresh', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    await connect();
    jest.spyOn(nostr, 'sync').mockRejectedValue(new Error('relay timeout'));

    await expect(useChatStore.getState().sync()).resolves.toBeUndefined();
    expect(xmtp.syncCount).toBeGreaterThan(0);
    expect(useChatStore.getState().syncing).toBe(false);
    expect(useChatStore.getState().protocols.nostr.history?.status).toBe('error');
  });

  it('shows cached chats during catch-up and lets each protocol finish independently', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    jest.spyOn(nostr, 'sync').mockReturnValue(pending);
    nostr.seedConversation({ id: 'cached' });
    const connecting = connect();
    for (
      let i = 0;
      i < 1_000 && useChatStore.getState().protocols.xmtp?.history?.status !== 'idle';
      i++
    ) {
      await Promise.resolve();
    }

    expect(useChatStore.getState().conversations.some((c) => c.id === ns('cached', 'nostr'))).toBe(
      true
    );
    expect(useChatStore.getState().protocols.nostr.history?.status).toBe('fetching');
    expect(useChatStore.getState().protocols.xmtp.history?.status).toBe('idle');
    expect(xmtp.syncCount).toBe(1);
    finish();
    await connecting;
    expect(useChatStore.getState().protocols.nostr.history?.status).toBe('idle');
  });

  it('does not restore a completed sync status after disconnect', async () => {
    const { nostr, connect } = twoTransports();
    await connect();
    let finish!: () => void;
    jest.spyOn(nostr, 'sync').mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const syncing = useChatStore.getState().sync();
    await disconnectFake();
    finish();
    await syncing;
    expect(useChatStore.getState().protocols).toEqual({});
    expect(useChatStore.getState().syncing).toBe(false);
  });
});

describe('streams', () => {
  it('namespaces messages arriving from each transport', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    xmtp.seedConversation({ id: 'c1' });
    nostr.seedConversation({ id: 'c1' });
    await connect();

    await useChatStore.getState().loadMessages(ns('c1'));
    await useChatStore.getState().loadMessages(ns('c1', 'nostr'));

    xmtp.deliver('c1', { content: { kind: 'text', text: 'from xmtp' } });
    nostr.deliver('c1', { content: { kind: 'text', text: 'from nostr' } });

    const state = useChatStore.getState();
    expect(state.messages[ns('c1')].at(-1)?.content).toEqual({ kind: 'text', text: 'from xmtp' });
    expect(state.messages[ns('c1', 'nostr')].at(-1)?.content).toEqual({
      kind: 'text',
      text: 'from nostr',
    });
  });
});

describe('teardown', () => {
  it('disconnects every transport', async () => {
    const { xmtp, nostr, connect } = twoTransports();
    await connect();

    await disconnectFake();

    expect(xmtp.disconnected).toBe(true);
    expect(nostr.disconnected).toBe(true);
    expect(useChatStore.getState().sessions).toEqual({});
    expect(useChatStore.getState().protocols).toEqual({});
  });
});

describe('identity', () => {
  it('selects the XMTP session for XMTP capabilities', async () => {
    const { xmtp, connect } = twoTransports();
    await connect();
    expect(xmtpSessionFor(useChatStore.getState())).toBe(xmtp);
    expect(xmtpSessionFor(useChatStore.getState())?.self.participantId).toBe(XMTP_SELF);
  });
});
