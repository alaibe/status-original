import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import type { DerivedKey } from '@/core/identity/keyring';
import { encodeNpub } from '@/lib/bech32';
import { randomBytes } from '@/lib/random';

export const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0";

export interface NostrIdentity {
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
}

export function identityFromDerivedKey(key: DerivedKey): NostrIdentity {
  const secretKey = key.privateKey.slice(0, 32);
  return identityFromSecretKey(secretKey);
}

export function identityFromSecretKey(secretKey: Uint8Array): NostrIdentity {
  const publicKeyBytes = schnorr.getPublicKey(secretKey);
  return {
    secretKey,
    publicKey: bytesToHex(publicKeyBytes),
    npub: encodeNpub(publicKeyBytes),
  };
}

export function ephemeralIdentity(): NostrIdentity {
  return identityFromSecretKey(randomBytes(32));
}
