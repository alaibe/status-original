import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';

import type { LocalAccount, Address } from 'viem';

import type { AccountKind } from './account-kind';
import { deriveEd25519, type Ed25519Key } from './slip10';
import * as Crypto from 'expo-crypto';
import { english, generateMnemonic, HDKey, hdKeyToAccount } from 'viem/accounts';

import { writeMnemonic } from './key-protection';
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes';
import { accountDbKeyName, vaultGet, vaultSet } from '@/storage/vault';

export interface DerivedKey {
  path: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface Keyring {
  kind: AccountKind;
  mnemonic: string | null;
  account: LocalAccount;
  address: Address;
  derive(path: string): DerivedKey;
  deriveEd25519(path: string): Ed25519Key;
}

export function createMnemonic(): string {
  return generateMnemonic(english);
}

export function isValidMnemonic(phrase: string): boolean {
  try {
    return validateMnemonic(normalizeMnemonic(phrase), english);
  } catch {
    return false;
  }
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export function keyringFromMnemonic(phrase: string, addressIndex = 0): Keyring {
  const mnemonic = normalizeMnemonic(phrase);
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const account = hdKeyToAccount(root, { addressIndex });

  return {
    kind: 'phrase',
    mnemonic,
    account,
    address: account.address,
    derive(path: string): DerivedKey {
      const node = root.derive(path);
      if (!node.privateKey || !node.publicKey) {
        throw new Error(`Could not derive a key at "${path}"`);
      }
      return { path, privateKey: node.privateKey, publicKey: node.publicKey };
    },
    deriveEd25519(path: string): Ed25519Key {
      return deriveEd25519(seed, path);
    },
  };
}

export async function persistAccountMnemonic(accountId: string, phrase: string): Promise<void> {
  await writeMnemonic(accountId, normalizeMnemonic(phrase));
}

export async function loadOrCreateDbEncryptionKey(accountId: string): Promise<Uint8Array> {
  const existing = await loadDbEncryptionKey(accountId);
  if (existing) return existing;

  const fresh = Crypto.getRandomBytes(32);
  await vaultSet(accountDbKeyName(accountId), bytesToBase64(fresh));
  return fresh;
}

export async function loadDbEncryptionKey(accountId: string): Promise<Uint8Array | null> {
  const value = await vaultGet(accountDbKeyName(accountId));
  if (!value) return null;
  const bytes = base64ToBytes(value);
  return bytes.length === 32 ? bytes : null;
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
