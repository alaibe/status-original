import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAccounts } from '../identity/accounts';
import { useChatStore } from '../messaging/chat-store';
import { InMemoryChatSession } from '../messaging/in-memory-session';
import { connectFake } from '../messaging/testing/store';
import { useIdentityStore } from '../identity/identity-store';
import { eraseAccount } from './erase-account';
import { accountRuntime } from '@/runtime';

jest.mock('../identity/keyring', () => ({
  ...jest.requireActual('../identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

beforeEach(async () => {
  await accountRuntime.synchronize(null);
  await AsyncStorage.clear();
  useIdentityStore.setState({
    status: 'absent',
    accounts: [],
    activeAccountId: null,
    keyring: null,
    error: null,
  });
  useChatStore.setState({
    status: 'idle',
    error: null,
    sessions: {},
    protocols: {},
    accountId: null,
    messageStore: null,
    conversations: [],
    messages: {},
    messageHistory: {},
    syncing: false,
    bots: {},
    readAt: {},
    chatPrefs: {},
    mediaIndex: {},
  });
});

async function connected() {
  const session = new InMemoryChatSession();
  session.seedConversation({ id: 'c1' });
  useIdentityStore.setState({
    status: 'ready',
    accounts: [
      {
        id: 'test-account',
        label: 'Test',
        address: '0x0000000000000000000000000000000000000001',
        createdAt: 1,
        kind: 'phrase',
      },
    ],
    activeAccountId: 'test-account',
  });
  await connectFake(session, { accountId: 'test-account' });
  return session;
}

describe('signOut', () => {
  it('erases the transport’s local database', async () => {
    const session = await connected();
    await eraseAccount();

    expect(session.erased).toBe(true);
    expect(session.disconnected).toBe(true);
  });

  it('clears every key the app owns', async () => {
    await AsyncStorage.multiSet([
      ['a.test-account.chat.readAt', '{}'],
      ['a.test-account.plugins.prefs', '{}'],
      ['a.test-account.plugin:ethereum:watched', '[]'],
    ]);
    await connected();

    await eraseAccount();

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('leaves storage it does not own alone', async () => {
    await AsyncStorage.setItem('some-library:cache', 'keep me');
    await connected();

    await eraseAccount();

    expect(await AsyncStorage.getItem('some-library:cache')).toBe('keep me');
  });

  it('resets in-memory state and the identity', async () => {
    await connected();
    await eraseAccount();

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(useChatStore.getState().sessions).toEqual({});
    expect(useIdentityStore.getState().status).toBe('absent');
    expect(useIdentityStore.getState().keyring).toBeNull();
  });

  it('erases an inactive account without disconnecting the active session', async () => {
    const session = await connected();
    const active = useIdentityStore.getState().accounts[0];
    const inactive = {
      ...active,
      id: 'inactive-account',
      label: 'Inactive',
      address: '0x0000000000000000000000000000000000000002' as const,
    };
    await saveAccounts([active, inactive]);
    useIdentityStore.setState({ accounts: [active, inactive] });

    await eraseAccount(inactive.id);

    expect(session.disconnected).toBe(false);
    expect(useChatStore.getState().sessions.xmtp).toBe(session);
    expect(useIdentityStore.getState().accounts).toEqual([active]);
  });

  it('keeps the account and allows retry when erasing a database fails', async () => {
    const session = await connected();
    useIdentityStore.setState({
      status: 'ready',
      accounts: [
        {
          id: 'test-account',
          label: 'Test',
          address: '0x0000000000000000000000000000000000000001',
          createdAt: 1,
          kind: 'phrase',
        },
      ],
      activeAccountId: 'test-account',
    });
    const disconnect = jest.spyOn(session, 'disconnect');
    jest.spyOn(session, 'eraseLocalDatabase').mockRejectedValueOnce(new Error('locked'));

    await expect(eraseAccount()).rejects.toThrow('locked');
    expect(useChatStore.getState().status).toBe('erasing');
    expect(useIdentityStore.getState().activeAccountId).toBe('test-account');
    expect(disconnect).toHaveBeenCalledTimes(1);

    await expect(eraseAccount()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(useIdentityStore.getState().keyring).toBeNull();
  });
});
describe('while an account is being erased', () => {
  it('never reports the idle state boot connects from', async () => {
    await connected();

    const seen: string[] = [];
    const stop = useChatStore.subscribe((state) => seen.push(state.status));

    await eraseAccount();
    stop();

    expect(seen.filter((s) => s === 'idle')).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe('idle');
    expect(seen.slice(0, -1).every((s) => s === 'erasing')).toBe(true);
  });
});
