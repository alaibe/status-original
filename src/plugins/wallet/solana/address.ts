import { base58 } from '@scure/base';
import { formatUnits } from 'viem';

import type { Ed25519Key } from '@/core/identity/slip10';

export const SOLANA_ACCOUNT_PATH = "m/44'/501'/0'/0'";

export function solanaAddress(key: Ed25519Key): string {
  return base58.encode(key.publicKey);
}

export function looksLikeSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return base58.decode(value).length === 32;
  } catch {
    return false;
  }
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}
