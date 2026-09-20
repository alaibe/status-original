import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export interface Ed25519Key {
  path: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

const HARDENED = 0x80000000;

function parseSegment(segment: string): number {
  if (!segment.endsWith("'") && !segment.endsWith('h')) {
    throw new Error(`ed25519 derivation is hardened-only; "${segment}" is not`);
  }
  const index = Number(segment.slice(0, -1));
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error(`"${segment}" is not a valid path segment`);
  }
  return index + HARDENED;
}

export function deriveEd25519(seed: Uint8Array, path: string): Ed25519Key {
  const segments = path.split('/');
  if (segments[0] !== 'm') throw new Error(`Path must start with "m": "${path}"`);

  let block = hmac(sha512, utf8ToBytes('ed25519 seed'), seed);
  let key = block.slice(0, 32);
  let chainCode = block.slice(32);

  for (const segment of segments.slice(1)) {
    const index = parseSegment(segment);

    const data = new Uint8Array(1 + 32 + 4);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);

    block = hmac(sha512, chainCode, data);
    key = block.slice(0, 32);
    chainCode = block.slice(32);
  }

  return { path, privateKey: key, publicKey: ed25519.getPublicKey(key) };
}
