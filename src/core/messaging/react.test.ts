import AsyncStorage from '@react-native-async-storage/async-storage';

import { STATUS_LOCAL_ID } from './bots';
import { useChatStore } from './chat-store';
import { InMemoryChatSession } from './in-memory-session';
import { InMemoryMessageStore } from './message-store';
import { connectFake, ns, projectTestAccount, resetChatStore } from './testing/store';

jest.mock('../identity/keyring', () => ({
  ...jest.requireActual('../identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

const SELF = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

function reactionsOn(conversationId: string, messageId: string): string[] {
  const list = useChatStore.getState().messages[conversationId] ?? [];
  return Object.keys(list.find((m) => m.id === messageId)?.reactions ?? {});
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
});

describe('react', () => {
  it('shows the reaction before the network has echoed it', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    const conversation = await session.createDm(PEER);
    const messageId = await session.send(conversation.id, { kind: 'text', text: 'hello' });
    await connectFake(session);
    await useChatStore.getState().loadMessages(ns(conversation.id));

    await useChatStore.getState().react(ns(conversation.id), messageId, '❤️');

    expect(reactionsOn(ns(conversation.id), messageId)).toEqual(['❤️']);
  });

  it('takes the reaction back when the send fails', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    const conversation = await session.createDm(PEER);
    const messageId = await session.send(conversation.id, { kind: 'text', text: 'hello' });
    await connectFake(session);
    await useChatStore.getState().loadMessages(ns(conversation.id));
    jest.spyOn(session, 'send').mockRejectedValueOnce(new Error('offline'));

    await expect(
      useChatStore.getState().react(ns(conversation.id), messageId, '❤️')
    ).rejects.toThrow('offline');

    expect(reactionsOn(ns(conversation.id), messageId)).toEqual([]);
  });

  it('works in a thread that never touches the network', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connectFake(session);
    await useChatStore
      .getState()
      .postLocalMessage(STATUS_LOCAL_ID, { kind: 'text', text: 'remember this' }, 'me');
    const messageId = useChatStore.getState().messages[STATUS_LOCAL_ID][0].id;

    await useChatStore.getState().react(STATUS_LOCAL_ID, messageId, '👍');

    expect(reactionsOn(STATUS_LOCAL_ID, messageId)).toEqual(['👍']);
  });

  it('toggles off when you tap the same emoji again', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connectFake(session);
    await useChatStore
      .getState()
      .postLocalMessage(STATUS_LOCAL_ID, { kind: 'text', text: 'remember this' }, 'me');
    const messageId = useChatStore.getState().messages[STATUS_LOCAL_ID][0].id;

    await useChatStore.getState().react(STATUS_LOCAL_ID, messageId, '👍');
    await useChatStore.getState().react(STATUS_LOCAL_ID, messageId, '👍');

    expect(reactionsOn(STATUS_LOCAL_ID, messageId)).toEqual([]);
  });

  it('restores a local reaction from message history', async () => {
    const store = new InMemoryMessageStore();
    projectTestAccount('reaction-test', store);
    await useChatStore
      .getState()
      .postLocalMessage(STATUS_LOCAL_ID, { kind: 'text', text: 'remember this' }, 'me');
    const messageId = useChatStore.getState().messages[STATUS_LOCAL_ID][0].id;
    await useChatStore.getState().react(STATUS_LOCAL_ID, messageId, '👍');

    useChatStore.setState({ messages: {} });
    await useChatStore.getState().loadMessages(STATUS_LOCAL_ID);

    expect(reactionsOn(STATUS_LOCAL_ID, messageId)).toEqual(['👍']);
  });
});
