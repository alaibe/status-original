import * as Crypto from 'expo-crypto';

import type { AccountKind } from './account-kind';
import type { Address } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { normalizeMnemonic } from './keyring';
import { toHex } from '@/lib/bytes';
import { VaultKey, vaultDelete, vaultGet, vaultSet } from '@/storage/vault';

export interface AccountRecord {
  id: string;
  label: string;
  address: Address;
  createdAt: number;
  kind: AccountKind;
  vendorId?: string;
}

export function createAccountId(): string {
  return toHex(Crypto.getRandomBytes(8));
}

export function addressForMnemonic(phrase: string): Address {
  return mnemonicToAccount(normalizeMnemonic(phrase)).address;
}

export async function loadAccounts(): Promise<AccountRecord[]> {
  const raw = await vaultGet(VaultKey.accountIndex);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AccountRecord[]) : [];
  } catch {
    return [];
  }
}

export async function saveAccounts(accounts: AccountRecord[]): Promise<void> {
  await vaultSet(VaultKey.accountIndex, JSON.stringify(accounts));
}

export async function loadActiveAccountId(): Promise<string | null> {
  return vaultGet(VaultKey.activeAccountId);
}

export async function setActiveAccountId(id: string | null): Promise<void> {
  if (id === null) {
    await vaultDelete(VaultKey.activeAccountId);
    return;
  }
  await vaultSet(VaultKey.activeAccountId, id);
}

export async function forgetAccount(id: string): Promise<AccountRecord[]> {
  const remaining = (await loadAccounts()).filter((a) => a.id !== id);
  await saveAccounts(remaining);

  if ((await loadActiveAccountId()) === id) {
    await setActiveAccountId(remaining[0]?.id ?? null);
  }
  return remaining;
}
