import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  loadAccounts,
  loadActiveAccountId,
} from './accounts';
import { eraseAccount, eraseAllAccounts } from '../app/erase-account';
import { useIdentityStore } from './identity-store';
import { scopePrefix } from '@/storage/scope';
import { accountMnemonicKey, VaultKey } from '@/storage/vault';

/** Two valid BIP-39 phrases, so "same device, two identities" is real. */
const PHRASE_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PHRASE_B = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

beforeEach(async () => {
  (SecureStore as unknown as { __reset(): void }).__reset();
  await AsyncStorage.clear();
  useIdentityStore.setState({
    status: 'loading',
    accounts: [],
    activeAccountId: null,
    keyring: null,
    error: null,
  });
});

describe('multiple accounts', () => {
  it('keeps both when a second is added', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);

    const { accounts, activeAccountId } = useIdentityStore.getState();
    expect(accounts).toHaveLength(2);
    // Adding an account switches to it.
    expect(activeAccountId).toBe(accounts[1].id);
  });

  it('gives each account its own keys', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);

    const [a, b] = useIdentityStore.getState().accounts;
    expect(a.address).not.toBe(b.address);
    expect(await SecureStore.getItemAsync(accountMnemonicKey(a.id))).not.toBe(
      await SecureStore.getItemAsync(accountMnemonicKey(b.id))
    );
  });

  it('switches to an existing account rather than importing it twice', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);

    await useIdentityStore.getState().adoptIdentity(PHRASE_A);

    const { accounts, activeAccountId } = useIdentityStore.getState();
    expect(accounts).toHaveLength(2);
    expect(activeAccountId).toBe(accounts[0].id);
  });

  it('points the storage scope at whichever account is active', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    const first = useIdentityStore.getState().accounts[0];

    await useIdentityStore.getState().adoptIdentity(PHRASE_B);
    const second = useIdentityStore.getState().accounts[1];
    await AsyncStorage.setItem(scopePrefix(second.id) + 'chat.readAt', '{"x":1}');

    await useIdentityStore.getState().selectAccount(first.id);

    // The second account's data is untouched but out of scope.
    expect(await AsyncStorage.getItem(scopePrefix(second.id) + 'chat.readAt')).toBe('{"x":1}');
    expect(useIdentityStore.getState().activeAccountId).toBe(first.id);
  });
});

describe('eraseAccount', () => {
  it('does not remove an inactive account or its keys when storage erase fails', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);
    const [inactive] = useIdentityStore.getState().accounts;
    await AsyncStorage.setItem(scopePrefix(inactive.id) + 'chat.readAt', '{}');
    jest.spyOn(AsyncStorage, 'multiRemove').mockRejectedValueOnce(new Error('storage busy'));

    await expect(eraseAccount(inactive.id)).rejects.toThrow('async-storage');

    expect(useIdentityStore.getState().accounts.map((account) => account.id)).toContain(inactive.id);
    expect(await SecureStore.getItemAsync(accountMnemonicKey(inactive.id))).not.toBeNull();
  });

  it('keeps the account index and keys when full-wipe data removal fails', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    const [account] = useIdentityStore.getState().accounts;
    await AsyncStorage.setItem(scopePrefix(account.id) + 'chat.readAt', '{}');
    jest.spyOn(AsyncStorage, 'multiRemove').mockRejectedValueOnce(new Error('storage busy'));

    await expect(eraseAllAccounts()).rejects.toThrow('async-storage');

    expect((await loadAccounts()).map((entry) => entry.id)).toEqual([account.id]);
    expect(await SecureStore.getItemAsync(accountMnemonicKey(account.id))).not.toBeNull();
  });

  it('destroys only the target account', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);
    const [a, b] = useIdentityStore.getState().accounts;

    await eraseAccount(a.id);

    expect(await SecureStore.getItemAsync(accountMnemonicKey(a.id))).toBeNull();
    expect(await SecureStore.getItemAsync(accountMnemonicKey(b.id))).not.toBeNull();
    expect((await loadAccounts()).map((x) => x.id)).toEqual([b.id]);
  });

  it('hands the active slot to a survivor', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);
    const [a, b] = useIdentityStore.getState().accounts;

    await useIdentityStore.getState().selectAccount(a.id);
    await eraseAccount(a.id);

    expect(await loadActiveAccountId()).toBe(b.id);
  });

  it('removes the account through the store, clearing its scoped data', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    await store.adoptIdentity(PHRASE_B);
    const [a, b] = useIdentityStore.getState().accounts;

    await AsyncStorage.setItem(scopePrefix(a.id) + 'chat.readAt', '{}');
    await AsyncStorage.setItem(scopePrefix(b.id) + 'chat.readAt', '{"keep":1}');

    await eraseAccount(a.id);

    expect(await AsyncStorage.getItem(scopePrefix(a.id) + 'chat.readAt')).toBeNull();
    expect(await AsyncStorage.getItem(scopePrefix(b.id) + 'chat.readAt')).toBe('{"keep":1}');
  });

  it('returns to onboarding when the last account goes', async () => {
    await useIdentityStore.getState().adoptIdentity(PHRASE_A);
    const [only] = useIdentityStore.getState().accounts;

    await eraseAccount(only.id);

    expect(useIdentityStore.getState().status).toBe('absent');
    expect(useIdentityStore.getState().keyring).toBeNull();
  });
});

describe('restore', () => {
  it('falls back to a surviving account when the stored active id is stale', async () => {
    const store = useIdentityStore.getState();
    await store.adoptIdentity(PHRASE_A);
    const [a] = useIdentityStore.getState().accounts;

    await SecureStore.setItemAsync(VaultKey.activeAccountId, 'no-such-account');
    await useIdentityStore.getState().restore();

    expect(useIdentityStore.getState().activeAccountId).toBe(a.id);
    expect(useIdentityStore.getState().status).toBe('ready');
  });
});
