import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { toHex } from '@/lib/bytes';

const WEB_PREFIX = 'vault:';

export const VaultKey = {
  accountIndex: 'accounts.index',
  activeAccountId: 'accounts.active',
  biometricLock: 'security.biometricLock',
  keyProtection: 'security.keyProtection',
} as const;

export type VaultKeyName = (typeof VaultKey)[keyof typeof VaultKey] | AccountScopedKey;

type AccountScopedKey =
  `account.${string}.${'mnemonic' | 'dbKey' | 'appDbKey' | 'protocols' | 'credentials'}`;

export function accountMnemonicKey(accountId: string): AccountScopedKey {
  return `account.${accountId}.mnemonic`;
}

export function accountDbKeyName(accountId: string): AccountScopedKey {
  return `account.${accountId}.dbKey`;
}

// The app database and XMTP database must not share key material.
export function accountAppDbKeyName(accountId: string): AccountScopedKey {
  return `account.${accountId}.appDbKey`;
}

export function accountProtocolConfigsKey(accountId: string): AccountScopedKey {
  return `account.${accountId}.protocols`;
}

export function accountCredentialsKey(accountId: string): AccountScopedKey {
  return `account.${accountId}.credentials`;
}

export function accountScopedKeys(accountId: string): VaultKeyName[] {
  return [
    accountMnemonicKey(accountId),
    accountDbKeyName(accountId),
    accountAppDbKeyName(accountId),
    accountProtocolConfigsKey(accountId),
    accountCredentialsKey(accountId),
  ];
}

export const isSecureStorageAvailable = process.env.EXPO_OS !== 'web';

const PROTECTED_SERVICE = 'com.statusoriginal.protected';

function protectedOptions(prompt: string): SecureStore.SecureStoreOptions {
  return {
    keychainService: PROTECTED_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: prompt,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

export type ProtectedRead =
  | { status: 'ok'; value: string }
  | { status: 'absent' }
  | { status: 'invalidated' }
  | { status: 'denied' };

export async function vaultGetProtected(
  key: VaultKeyName,
  prompt: string,
  expectExisting: boolean,
): Promise<ProtectedRead> {
  if (process.env.EXPO_OS === 'web') {
    const value = await vaultGet(key);
    return value === null ? { status: 'absent' } : { status: 'ok', value };
  }

  try {
    const value = await SecureStore.getItemAsync(key, protectedOptions(prompt));
    if (value !== null) return { status: 'ok', value };
    return expectExisting ? { status: 'invalidated' } : { status: 'absent' };
  } catch {
    return { status: 'denied' };
  }
}

export async function vaultSetProtected(key: VaultKeyName, value: string): Promise<void> {
  if (process.env.EXPO_OS === 'web') {
    await vaultSet(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, protectedOptions('Confirm to save your keys'));
}

export async function vaultDeleteProtected(key: VaultKeyName): Promise<void> {
  if (process.env.EXPO_OS === 'web') {
    await vaultDelete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key, {
    keychainService: PROTECTED_SERVICE,
  });
}

export async function vaultGet(key: VaultKeyName): Promise<string | null> {
  if (process.env.EXPO_OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(WEB_PREFIX + key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function vaultSet(key: VaultKeyName, value: string): Promise<void> {
  if (process.env.EXPO_OS === 'web') {
    globalThis.localStorage?.setItem(WEB_PREFIX + key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function vaultDelete(key: VaultKeyName): Promise<void> {
  if (process.env.EXPO_OS === 'web') {
    globalThis.localStorage?.removeItem(WEB_PREFIX + key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function accountDatabaseKey(accountId: string): Promise<string> {
  const name = accountAppDbKeyName(accountId);

  const existing = await vaultGet(name);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;

  const fresh = toHex(Crypto.getRandomBytes(32));
  await vaultSet(name, fresh);
  return fresh;
}

export async function vaultWipe(accountIds: string[] = []): Promise<void> {
  const accountKeys = accountIds.flatMap((id) => accountScopedKeys(id));
  await Promise.all(accountKeys.map((key) => vaultDelete(key)));
  await Promise.all(accountIds.map((id) => vaultDeleteProtected(accountMnemonicKey(id))));

  const deviceKeys = Object.values(VaultKey).filter((key) => key !== VaultKey.accountIndex);
  await Promise.all(deviceKeys.map((key) => vaultDelete(key)));
  await vaultDelete(VaultKey.accountIndex);
}
