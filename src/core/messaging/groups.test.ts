import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChatStore } from './chat-store';
import { InMemoryChatSession } from './in-memory-session';
import { connectFake, native, ns, resetChatStore } from './testing/store';

jest.mock('../identity/keyring', () => ({
  ...jest.requireActual('../identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

const SELF = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);

const connect = (session: InMemoryChatSession) => connectFake(session);

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
});

describe('creating a group', () => {
  it('includes the creator and marks them owner', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);

    const group = await useChatStore.getState().startGroup('xmtp', [ALICE, BOB], 'Weekend');

    expect(group.kind).toBe('group');
    expect(group.title).toBe('Weekend');
    expect(group.memberIds).toEqual([SELF, ALICE, BOB]);
    expect(group.selfRole).toBe('owner');
  });

  it('appears in the conversation list immediately', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);

    await useChatStore.getState().startGroup('xmtp', [ALICE], 'Duo');

    expect(useChatStore.getState().conversations.map((c) => c.title)).toContain('Duo');
  });
});

describe('membership', () => {
  it('adds and removes members, keeping the roster in sync', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);
    const group = await useChatStore.getState().startGroup('xmtp', [ALICE], 'Team');

    await useChatStore.getState().addMembers(group.id, [BOB]);
    expect(await useChatStore.getState().getMembers(group.id)).toEqual([
      { id: SELF, role: 'owner' },
      { id: ALICE, role: 'member' },
      { id: BOB, role: 'member' },
    ]);

    await useChatStore.getState().removeMembers(group.id, [ALICE]);
    const remaining = await useChatStore.getState().getMembers(group.id);
    expect(remaining.map((m) => m.id)).toEqual([SELF, BOB]);
  });

  it('reports roles, which is what gates the destructive commands', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);
    const group = await useChatStore.getState().startGroup('xmtp', [ALICE, BOB], 'Team');
    session.seedRole(native(group.id), ALICE, 'admin');

    const members = await useChatStore.getState().getMembers(group.id);
    expect(members.find((m) => m.id === ALICE)?.role).toBe('admin');
    expect(members.find((m) => m.id === BOB)?.role).toBe('member');
  });

  it('renames a group', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);
    const group = await useChatStore.getState().startGroup('xmtp', [ALICE], 'Old');

    await useChatStore.getState().renameGroup(group.id, 'New');

    expect(
      useChatStore.getState().conversations.find((c) => c.id === group.id)?.title
    ).toBe('New');
  });
});

describe('leaving', () => {
  it('drops the conversation and its transcript locally', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);
    const group = await useChatStore.getState().startGroup('xmtp', [ALICE], 'Team');
    await useChatStore.getState().loadMessages(group.id);

    await useChatStore.getState().leaveGroup(group.id);

    expect(session.left).toEqual([native(group.id)]);
    expect(useChatStore.getState().conversations.find((c) => c.id === group.id)).toBeUndefined();
    expect(useChatStore.getState().messages[group.id]).toBeUndefined();
  });
});

describe('group operations refuse non-groups', () => {
  it('rejects membership calls on a DM', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    session.seedConversation({ id: 'dm-1', kind: 'dm' });
    await connect(session);

    await expect(useChatStore.getState().getMembers(ns('dm-1'))).rejects.toThrow(
      /only works in a group/
    );
    await expect(useChatStore.getState().addMembers(ns('dm-1'), [BOB])).rejects.toThrow(
      /only works in a group/
    );
  });

  it('refuses everything before the session exists', async () => {
    await expect(useChatStore.getState().getMembers('anything')).rejects.toThrow(/Not connected/);
  });
});

describe('group messages', () => {
  it('carries sender identity so the UI can attribute them', async () => {
    const session = new InMemoryChatSession({ participantId: SELF });
    await connect(session);
    const group = await useChatStore.getState().startGroup('xmtp', [ALICE, BOB], 'Team');
    await useChatStore.getState().loadMessages(group.id);

    session.deliver(native(group.id), { senderId: ALICE, content: { kind: 'text', text: 'hi all' } });
    session.deliver(native(group.id), { senderId: BOB, content: { kind: 'text', text: 'hey' } });

    const messages = useChatStore.getState().messages[group.id];
    expect(messages.map((m) => m.senderId)).toEqual([ALICE, BOB]);
    expect(messages.every((m) => !m.fromMe)).toBe(true);
  });
});
