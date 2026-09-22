import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChatStore } from './chat-store';
import { InMemoryChatSession } from './in-memory-session';
import { InMemoryMessageStore } from './message-store';
import {
  connectFake,
  disconnectFake,
  ns,
  projectTestAccount,
  resetChatStore,
} from './testing/store';

jest.mock('../identity/keyring', () => ({
  ...jest.requireActual('../identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

const connect = (session: InMemoryChatSession) => connectFake(session);

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
});

describe('connecting', () => {
  it('lists conversations and reports ready', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1', title: 'Alice' });

    await connect(session);

    expect(useChatStore.getState().status).toBe('ready');
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual([ns('c1')]);
  });

  it('surfaces a failure instead of hanging in "connecting"', async () => {
    await connectFake(new InMemoryChatSession(), {
      sessionFor: () => {
        throw new Error('network down');
      },
    });

    expect(useChatStore.getState().status).toBe('error');
    expect(useChatStore.getState().error).toBe('network down');
  });
});

describe('sending', () => {
  it('shows the message optimistically, then marks it sent', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));

    await useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'hi' });

    const messages = useChatStore.getState().messages[ns('c1')];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ fromMe: true, status: 'sent' });
    expect(session.sent).toEqual([{ conversationId: 'c1', content: { kind: 'text', text: 'hi' } }]);
  });

  /**
   * A failed send is reported on the message, not thrown. Throwing would put
   * an error banner over the composer as well as the red mark on the bubble,
   * and leave the text in the input, so the obvious next move is to press
   * send again and end up with the same message in the thread twice.
   */
  it('marks a failed send rather than throwing', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));

    jest.spyOn(session, 'send').mockRejectedValueOnce(new Error('rejected'));

    await expect(
      useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'nope' })
    ).resolves.toBeUndefined();

    // The bubble stays, flagged: losing the user's text would be worse.
    const messages = useChatStore.getState().messages[ns('c1')];
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('failed');
  });

  it('sends a failed message again, in place', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));

    jest.spyOn(session, 'send').mockRejectedValueOnce(new Error('rejected'));
    await useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'nope' });

    const failed = useChatStore.getState().messages[ns('c1')][0];
    expect(failed.status).toBe('failed');

    await useChatStore.getState().retryMessage(ns('c1'), failed.id);

    const after = useChatStore.getState().messages[ns('c1')];
    // Same message, same place in the thread: a retry is this message getting
    // through, not a new one at the bottom.
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(failed.id);
    expect(after[0].status).toBe('sent');
    expect(session.sent).toEqual([
      { conversationId: 'c1', content: { kind: 'text', text: 'nope' } },
    ]);
  });

  it('leaves a delivered message alone when asked to retry it', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));
    await useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'hi' });

    const delivered = useChatStore.getState().messages[ns('c1')][0];
    await useChatStore.getState().retryMessage(ns('c1'), delivered.id);

    // One send, not two. Re-sending something already delivered would put it
    // in the other person's thread twice.
    expect(session.sent).toHaveLength(1);
  });

  it('reconciles one echoed send without removing another concurrent send', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));

    const finishes: (() => void)[] = [];
    jest
      .spyOn(session, 'send')
      .mockImplementation(
        () => new Promise<string>((resolve) => finishes.push(() => resolve('sent')))
      );
    const first = useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'first' });
    const second = useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'second' });

    session.deliver('c1', {
      id: 'echo-first',
      senderId: session.self.participantId,
      fromMe: true,
      content: { kind: 'text', text: 'first' },
    });

    const afterEcho = useChatStore.getState().messages[ns('c1')];
    expect(afterEcho).toHaveLength(2);
    expect(afterEcho.find((message) => message.id.startsWith('pending:'))?.content).toEqual({
      kind: 'text',
      text: 'second',
    });
    expect(afterEcho.find((message) => message.id === 'echo-first')?.content).toEqual({
      kind: 'text',
      text: 'first',
    });
    finishes.forEach((finish) => finish());
    await Promise.all([first, second]);
  });

  it('reconciles only one pending row when concurrent sends have identical content', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));
    jest.spyOn(session, 'send').mockReturnValue(new Promise(() => {}));

    void useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'same' });
    void useChatStore.getState().sendMessage(ns('c1'), { kind: 'text', text: 'same' });
    session.deliver('c1', {
      id: 'one-echo',
      senderId: session.self.participantId,
      fromMe: true,
      content: { kind: 'text', text: 'same' },
    });

    const messages = useChatStore.getState().messages[ns('c1')];
    expect(messages.filter((message) => message.id.startsWith('pending:'))).toHaveLength(1);
    expect(messages).toHaveLength(2);
  });
});

describe('receiving', () => {
  it('ingests a streamed message and updates the conversation preview', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));

    session.deliver('c1', { content: { kind: 'text', text: 'incoming' } });

    const state = useChatStore.getState();
    expect(state.messages[ns('c1')].at(-1)?.content).toEqual({ kind: 'text', text: 'incoming' });
    expect(state.conversations[0].lastMessage?.content).toEqual({
      kind: 'text',
      text: 'incoming',
    });
  });

  it('does not materialise history for a conversation the user never opened', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);

    session.deliver('c1');

    // Preview updates; the transcript stays unloaded until it is opened.
    expect(useChatStore.getState().messages[ns('c1')]).toBeUndefined();
    expect(useChatStore.getState().conversations[0].lastMessage).toBeDefined();
  });

  it('adds a conversation announced mid-session', async () => {
    const session = new InMemoryChatSession();
    await connect(session);

    session.announce({
      id: 'c2',
      kind: 'dm',
      title: 'Bob',
      memberIds: [],
      createdAt: 5_000,
      consent: 'unknown',
    });

    expect(useChatStore.getState().conversations.map((c) => c.id)).toContain(ns('c2'));
  });

  it('orders conversations by most recent activity', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'old', createdAt: 1_000 });
    session.seedConversation({ id: 'new', createdAt: 2_000 });
    await connect(session);

    session.deliver('old', { sentAt: 9_000 });

    expect(useChatStore.getState().conversations[0].id).toBe(ns('old'));
  });
});

describe('stored history pagination', () => {
  it('loads messages older than the initial hydration window', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'long' });
    for (let index = 1; index <= 600; index++) {
      session.deliver('long', {
        id: `m${String(index).padStart(3, '0')}`,
        sentAt: index,
        content: { kind: 'text', text: String(index) },
      });
    }
    await connect(session);

    await useChatStore.getState().loadMessages(ns('long'));
    expect(useChatStore.getState().messages[ns('long')]).toHaveLength(500);
    expect(useChatStore.getState().messageHistory[ns('long')].hasOlder).toBe(true);

    await useChatStore.getState().loadOlderMessages(ns('long'));
    expect(useChatStore.getState().messages[ns('long')]).toHaveLength(600);
    expect(useChatStore.getState().messages[ns('long')][0].id).toBe('m001');
  });

  it('pages local conversation history from the account store', async () => {
    const store = new InMemoryMessageStore();
    projectTestAccount('test-account', store);
    for (let index = 1; index <= 600; index++) {
      await store.insertMessage({
        id: `local-${String(index).padStart(3, '0')}`,
        conversationId: 'local-status',
        senderId: 'me',
        sentAt: index,
        content: { kind: 'text', text: String(index) },
        fromMe: true,
        status: 'sent',
      });
    }

    await useChatStore.getState().loadMessages('local-status');
    expect(useChatStore.getState().messages['local-status']).toHaveLength(500);
    await useChatStore.getState().loadOlderMessages('local-status');
    expect(useChatStore.getState().messages['local-status']).toHaveLength(600);
    expect(useChatStore.getState().messages['local-status'][0].id).toBe('local-001');
  });

  it('folds a newer reaction when its target arrives from an older page', async () => {
    const store = new InMemoryMessageStore();
    projectTestAccount('test-account', store);
    for (let index = 1; index <= 500; index++) {
      await store.insertMessage({
        id: `m${String(index).padStart(3, '0')}`,
        conversationId: 'local-status',
        senderId: 'me',
        sentAt: index,
        content: { kind: 'text', text: String(index) },
        fromMe: true,
        status: 'sent',
      });
    }
    await store.insertMessage({
      id: 'reaction-newer',
      conversationId: 'local-status',
      senderId: 'me',
      sentAt: 501,
      content: { kind: 'reaction', targetId: 'm001', emoji: '👍', action: 'added' },
      fromMe: true,
      status: 'sent',
    });

    await useChatStore.getState().loadMessages('local-status');
    expect(
      useChatStore.getState().messages['local-status'].some((entry) => entry.id === 'm001')
    ).toBe(false);
    await useChatStore.getState().loadOlderMessages('local-status');

    expect(
      useChatStore.getState().messages['local-status'].find((entry) => entry.id === 'm001')
        ?.reactions
    ).toEqual({ '👍': ['me'] });
  });
});

describe('account-bound async projections', () => {
  it('does not project a deferred conversation refresh after an account switch', async () => {
    const old = new InMemoryChatSession();
    const deferred = defer<Awaited<ReturnType<InMemoryChatSession['listConversations']>>>();
    jest.spyOn(old, 'listConversations').mockReturnValue(deferred.promise);
    projectTestAccount('old');
    useChatStore.setState({ sessions: { xmtp: old } });

    const refreshing = useChatStore.getState().refreshConversations();
    projectTestAccount('new');
    useChatStore.setState({ conversations: [testConversation('new-conversation')] });
    deferred.resolve([testConversation('old-conversation')]);
    await refreshing;

    expect(useChatStore.getState().conversations.map((entry) => entry.id)).toEqual([
      'new-conversation',
    ]);
  });

  it.each(['startDm', 'startGroup'] as const)(
    'does not project deferred %s after an account switch',
    async (operation) => {
      const old = new InMemoryChatSession();
      const deferred = defer<Awaited<ReturnType<InMemoryChatSession['createDm']>>>();
      if (operation === 'startDm') jest.spyOn(old, 'createDm').mockReturnValue(deferred.promise);
      else jest.spyOn(old, 'createGroup').mockReturnValue(deferred.promise);
      projectTestAccount('old');
      useChatStore.setState({ sessions: { xmtp: old } });

      const starting =
        operation === 'startDm'
          ? useChatStore.getState().startDm('xmtp', 'peer')
          : useChatStore.getState().startGroup('xmtp', ['peer'], 'Old');
      projectTestAccount('new');
      useChatStore.setState({ conversations: [testConversation('new-conversation')] });
      deferred.resolve(testConversation('native-old'));
      await starting;

      expect(useChatStore.getState().conversations.map((entry) => entry.id)).toEqual([
        'new-conversation',
      ]);
    }
  );

  it.each(['addMembers', 'removeMembers', 'renameGroup', 'leaveGroup'] as const)(
    'does not project deferred %s completion after an account switch',
    async (operation) => {
      const old = new InMemoryChatSession();
      old.seedConversation({ id: 'group', kind: 'group', memberIds: ['me', 'peer'] });
      const deferred = defer<void>();
      jest.spyOn(old, operation).mockReturnValue(deferred.promise);
      projectTestAccount('old');
      useChatStore.setState({
        sessions: { xmtp: old },
        conversations: [testConversation(ns('group'))],
      });

      const state = useChatStore.getState();
      const mutating =
        operation === 'addMembers'
          ? state.addMembers(ns('group'), ['other'])
          : operation === 'removeMembers'
            ? state.removeMembers(ns('group'), ['peer'])
            : operation === 'renameGroup'
              ? state.renameGroup(ns('group'), 'Renamed')
              : state.leaveGroup(ns('group'));
      projectTestAccount('new');
      useChatStore.setState({ conversations: [testConversation('new-conversation')] });
      deferred.resolve();
      await mutating;

      expect(useChatStore.getState().conversations.map((entry) => entry.id)).toEqual([
        'new-conversation',
      ]);
    }
  );
});

describe('local persistence failures', () => {
  it.each(['message', 'private message', 'reaction'] as const)(
    'does not show a %s as sent',
    async (kind) => {
      class FailingStore extends InMemoryMessageStore {
        override async insertMessage(): Promise<boolean> {
          throw new Error('disk full');
        }
      }
      projectTestAccount('test-account', new FailingStore());
      const target = {
        id: 'target',
        conversationId: 'local-status',
        senderId: 'me',
        sentAt: 1,
        content: { kind: 'text' as const, text: 'target' },
        fromMe: true,
        status: 'sent' as const,
      };
      useChatStore.setState({
        conversations: [testConversation('local-status')],
        messages: { 'local-status': [target] },
        rawMessages: { 'local-status': [target] },
      });

      const action =
        kind === 'message'
          ? useChatStore
              .getState()
              .postLocalMessage('local-status', { kind: 'text', text: 'new' }, 'me')
          : kind === 'private message'
            ? useChatStore
                .getState()
                .postPrivateMessage('local-status', { kind: 'text', text: 'private' })
            : useChatStore.getState().react('local-status', 'target', '👍');
      await expect(action).rejects.toThrow('disk full');

      expect(useChatStore.getState().messages['local-status']).toEqual([target]);
    }
  );
});

describe('private command output', () => {
  it('restores local-only output beside network history', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    const store = new InMemoryMessageStore();
    projectTestAccount('test-account', store);
    await connect(session);
    await useChatStore.getState().loadMessages(ns('c1'));
    await useChatStore.getState().postPrivateMessage(ns('c1'), {
      kind: 'text',
      text: 'only on this device',
    });

    useChatStore.setState({ messages: {} });
    await useChatStore.getState().loadMessages(ns('c1'));

    expect(useChatStore.getState().messages[ns('c1')]).toEqual([
      expect.objectContaining({
        privateToMe: true,
        content: { kind: 'text', text: 'only on this device' },
      }),
    ]);
  });
});

describe('disconnecting', () => {
  it('clears network state', async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'c1' });
    await connect(session);

    await disconnectFake();

    expect(session.disconnected).toBe(true);
    expect(useChatStore.getState().status).toBe('idle');
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });
});

describe('consent', () => {
  /** A stranger's conversation: present, but not yet replied to. */
  const withRequest = async () => {
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'spam', title: 'Stranger', consent: 'unknown' });
    await connect(session);
    return session;
  };

  it('accepts a request', async () => {
    const session = await withRequest();

    await useChatStore.getState().setConsent(ns('spam'), 'allowed');

    expect(useChatStore.getState().conversations.find((c) => c.id === ns('spam'))?.consent).toBe(
      'allowed'
    );
    expect((await session.listConversations()).find((c) => c.id === 'spam')?.consent).toBe(
      'allowed'
    );
  });

  it('refusing tells the transport, so the decision outlives this device', async () => {
    const session = await withRequest();

    await useChatStore.getState().setConsent(ns('spam'), 'denied');

    // The point of routing this through the session rather than a local flag:
    // a reinstall, and this identity's other phone, both have to see it.
    expect((await session.listConversations()).find((c) => c.id === 'spam')?.consent).toBe(
      'denied'
    );
  });

  it('puts the conversation back when the transport refuses', async () => {
    const session = await withRequest();
    session.setConsent = async () => {
      throw new Error('offline');
    };

    await expect(useChatStore.getState().setConsent(ns('spam'), 'denied')).rejects.toThrow(
      'offline'
    );

    // The update is optimistic, so a failure has to undo it; otherwise the row
    // stays gone and the stranger silently reappears on the next sync.
    expect(useChatStore.getState().conversations.find((c) => c.id === ns('spam'))?.consent).toBe(
      'unknown'
    );
  });

  it('says so when the transport has no notion of consent', async () => {
    const session = await withRequest();
    // Nostr and Waku have no roster and no stranger, so they omit the method
    // rather than pretending to honour it. Assigned rather than deleted: it
    // lives on the prototype, which `delete` on the instance does not touch.
    (session as { setConsent?: unknown }).setConsent = undefined;

    await expect(useChatStore.getState().setConsent(ns('spam'), 'denied')).rejects.toThrow(
      /no way to refuse/
    );
  });
});

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function testConversation(id: string) {
  return {
    id,
    kind: 'dm' as const,
    title: id,
    memberIds: [],
    createdAt: 1,
    consent: 'allowed' as const,
  };
}
