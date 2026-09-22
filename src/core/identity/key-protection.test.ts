import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  disableKeyProtection,
  enableKeyProtection,
  isKeyProtectionEnabled,
  readMnemonic,
} from './key-protection';
import { useIdentityStore } from './identity-store';
import { eraseAccount, eraseAllAccounts } from '../app/erase-account';
import { accountMnemonicKey, VaultKey } from '@/storage/vault';

const PHRASE_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PHRASE_B = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

type Harness = {
  __reset(): void;
  __invalidateProtected(): void;
  __denyProtected(value: boolean): void;
};
const keychain = SecureStore as unknown as Harness;

beforeEach(async () => {
  keychain.__reset();
  await AsyncStorage.clear();
  useIdentityStore.setState({
    status: 'loading',
    accounts: [],
    activeAccountId: null,
    keyring: null,
    error: null,
  });
});

async function withTwoAccounts() {
  const store = useIdentityStore.getState();
  await store.adoptIdentity(PHRASE_A);
  await useIdentityStore.getState().adoptIdentity(PHRASE_B);
  return useIdentityStore.getState().accounts;
}

describe('enabling key protection', () => {
  it('moves every phrase into the sealed store and removes the plain copy', async () => {
    const accounts = await withTwoAccounts();

    expect(await enableKeyProtection(accounts.map((a) => a.id))).toEqual({ ok: true });
    expect(await isKeyProtectionEnabled()).toBe(true);

    for (const account of accounts) {
      // Gone from the ordinary keychain service…
      expect(await SecureStore.getItemAsync(accountMnemonicKey(account.id))).toBeNull();
      // …and readable through the protected path.
      expect(await readMnemonic(account.id, true)).toEqual({
        status: 'ok',
        value: expect.any(String),
      });
    }
  });

  it('flips the setting only after every account has moved', async () => {
    // A half-migrated device that believed its keys were sealed would read
    // through the protected path and find nothing.
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    const sealed = await Promise.all(accounts.map((a) => readMnemonic(a.id, true)));
    expect(sealed.every((r) => r.status === 'ok')).toBe(true);
  });
});

describe('disabling key protection', () => {
  it('moves phrases back and clears the setting', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    expect(await disableKeyProtection(accounts.map((a) => a.id))).toEqual({ ok: true });
    expect(await isKeyProtectionEnabled()).toBe(false);
    expect(await SecureStore.getItemAsync(accountMnemonicKey(accounts[0].id))).not.toBeNull();
  });

  it('changes nothing when the prompt is refused', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    keychain.__denyProtected(true);
    expect(await disableKeyProtection(accounts.map((a) => a.id))).toEqual({
      ok: false,
      reason: 'denied',
    });

    // Still sealed: a half-unsealed device is worse than an unchanged one.
    expect(await isKeyProtectionEnabled()).toBe(true);
    keychain.__denyProtected(false);
    expect((await readMnemonic(accounts[0].id, true)).status).toBe('ok');
  });
});

describe('when the system discards sealed keys', () => {
  it('reports invalidated rather than absent for a known account', async () => {
    // SecureStore resolves null in both cases; only the caller knows the
    // account is in the registry, and confusing the two would silently drop it.
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    keychain.__invalidateProtected();

    expect(await readMnemonic(accounts[0].id, true)).toEqual({ status: 'invalidated' });
  });

  it('puts the identity store into the invalidated state on restore', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));
    keychain.__invalidateProtected();

    await useIdentityStore.getState().restore();

    expect(useIdentityStore.getState().status).toBe('invalidated');
    expect(useIdentityStore.getState().keyring).toBeNull();
    // The accounts themselves survive; only the phrases were lost.
    expect(useIdentityStore.getState().accounts).toHaveLength(2);
  });

  it('repairs an account when its phrase is imported again', async () => {
    // The record, database and local data are all intact. Merely selecting the
    // account would read the missing key and bounce back to recovery, so the
    // import path has to rewrite it.
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));
    keychain.__invalidateProtected();
    await useIdentityStore.getState().restore();
    expect(useIdentityStore.getState().status).toBe('invalidated');

    await useIdentityStore.getState().adoptIdentity(PHRASE_A);

    expect(useIdentityStore.getState().status).toBe('ready');
    expect(useIdentityStore.getState().accounts).toHaveLength(2);
    expect(useIdentityStore.getState().activeAccountId).toBe(accounts[0].id);
  });
});

describe('a refused prompt', () => {
  it('blocks rather than invalidates, so it can be retried', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    keychain.__denyProtected(true);
    await useIdentityStore.getState().restore();
    expect(useIdentityStore.getState().status).toBe('blocked');

    keychain.__denyProtected(false);
    expect(await useIdentityStore.getState().retryUnlock()).toBe(true);
    expect(useIdentityStore.getState().status).toBe('ready');
  });
});

describe('erasing', () => {
  it('removes the sealed phrase too', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    await eraseAccount(accounts[0].id);

    expect(await readMnemonic(accounts[0].id, false)).toEqual({ status: 'absent' });
    expect((await readMnemonic(accounts[1].id, true)).status).toBe('ok');
  });

  it('leaves nothing behind on a full wipe', async () => {
    const accounts = await withTwoAccounts();
    await enableKeyProtection(accounts.map((a) => a.id));

    await eraseAllAccounts();

    for (const account of accounts) {
      expect(await readMnemonic(account.id, false)).toEqual({ status: 'absent' });
    }
    expect(await SecureStore.getItemAsync(VaultKey.keyProtection)).toBeNull();
  });
});
