import { bech32 } from '@scure/base';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const BIP84_ACCOUNT_PATH = "m/84'/0'/0'/0/0";

export const NETWORK_PREFIX = { mainnet: 'bc', testnet: 'tb' } as const;
export type BitcoinNetwork = keyof typeof NETWORK_PREFIX;

export function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function p2wpkhAddress(publicKey: Uint8Array, network: BitcoinNetwork = 'mainnet'): string {
  if (publicKey.length !== 33) {
    throw new Error(`Expected a 33-byte compressed public key, got ${publicKey.length} bytes.`);
  }

  const program = hash160(publicKey);
  const words = [0, ...bech32.toWords(program)];
  return bech32.encode(NETWORK_PREFIX[network], words);
}

export function isBitcoinAddress(value: string): boolean {
  const trimmed = value.trim();
  if (/^(bc1|tb1)[023456789acdefghjklmnpqrstuvwxyz]{8,}$/i.test(trimmed)) return true;
  return /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed);
}
