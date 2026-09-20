import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import {
  base64ToBytes,
  calcPaddedLen,
  conversationKey,
  decrypt,
  decryptWithKey,
  encrypt,
  encryptWithKey,
} from '@/lib/nip44';

/**
 * NIP-44 v2.
 *
 * These are round-trip and structural tests. They prove the implementation is
 * self-consistent and that its payload has the shape the spec describes. They
 * do not prove interoperability with any other Nostr client: that needs the
 * official test vectors or a real client on the other end, and inventing
 * vectors would be worse than having none, because a wrong one would look like
 * evidence.
 */

const ALICE_SECRET = new Uint8Array(32).fill(1);
const BOB_SECRET = new Uint8Array(32).fill(2);
const ALICE_PUB = bytesToHex(schnorr.getPublicKey(ALICE_SECRET));
const BOB_PUB = bytesToHex(schnorr.getPublicKey(BOB_SECRET));

describe('conversation key', () => {
  it('is the same from both sides, which is what makes ECDH usable at all', () => {
    expect(bytesToHex(conversationKey(ALICE_SECRET, BOB_PUB))).toBe(
      bytesToHex(conversationKey(BOB_SECRET, ALICE_PUB))
    );
  });

  it('differs for a different peer', () => {
    const carol = new Uint8Array(32).fill(3);
    expect(bytesToHex(conversationKey(ALICE_SECRET, BOB_PUB))).not.toBe(
      bytesToHex(conversationKey(ALICE_SECRET, bytesToHex(schnorr.getPublicKey(carol))))
    );
  });
});

describe('round trip', () => {
  it('decrypts what it encrypted, in both directions', () => {
    const payload = encrypt('hello there', ALICE_SECRET, BOB_PUB);
    expect(decrypt(payload, BOB_SECRET, ALICE_PUB)).toBe('hello there');
  });

  it('survives multi-byte characters', () => {
    const text = 'héllo 🌍 — ünïcode';
    expect(decrypt(encrypt(text, ALICE_SECRET, BOB_PUB), BOB_SECRET, ALICE_PUB)).toBe(text);
  });

  it('handles the padding boundaries', () => {
    // 32 is the floor; 33 forces the first bucket jump; 256/257 crosses the
    // point where the chunk size changes from 32 to nextPower/8.
    for (const length of [1, 31, 32, 33, 255, 256, 257, 1000]) {
      const text = 'x'.repeat(length);
      expect(decrypt(encrypt(text, ALICE_SECRET, BOB_PUB), BOB_SECRET, ALICE_PUB)).toBe(text);
    }
  });

  it('produces a different payload each time, because the nonce is fresh', () => {
    const a = encrypt('same', ALICE_SECRET, BOB_PUB);
    const b = encrypt('same', ALICE_SECRET, BOB_PUB);
    expect(a).not.toBe(b);
  });
});

describe('payload structure', () => {
  it('is version 2, a 32-byte nonce and a 32-byte MAC', () => {
    const bytes = base64ToBytes(encrypt('hello', ALICE_SECRET, BOB_PUB));
    expect(bytes[0]).toBe(2);
    // 1 version + 32 nonce + 32 padded ciphertext (2-byte prefix + 5 + pad) + 32 mac
    expect(bytes.length).toBe(1 + 32 + 34 + 32);
  });

  it('pads to the bucket sizes the spec describes', () => {
    expect(calcPaddedLen(1)).toBe(32);
    expect(calcPaddedLen(32)).toBe(32);
    expect(calcPaddedLen(33)).toBe(64);
    expect(calcPaddedLen(64)).toBe(64);
    expect(calcPaddedLen(65)).toBe(96);
    expect(calcPaddedLen(256)).toBe(256);
    expect(calcPaddedLen(257)).toBe(320);
  });

  it('hides the exact length of short messages', () => {
    // The point of padding: "yes" and "no" must not be distinguishable by size.
    const yes = base64ToBytes(encrypt('yes', ALICE_SECRET, BOB_PUB)).length;
    const no = base64ToBytes(encrypt('no', ALICE_SECRET, BOB_PUB)).length;
    expect(yes).toBe(no);
  });
});

describe('tampering', () => {
  const key = conversationKey(ALICE_SECRET, BOB_PUB);

  it('rejects a flipped ciphertext bit', () => {
    const bytes = base64ToBytes(encryptWithKey('hello', key));
    bytes[40] ^= 0x01;
    expect(() => decryptWithKey(toBase64(bytes), key)).toThrow(/MAC mismatch/);
  });

  it('rejects a rewritten nonce', () => {
    // The MAC covers nonce || ciphertext precisely so this fails. A MAC over
    // the ciphertext alone would let the nonce be swapped.
    const bytes = base64ToBytes(encryptWithKey('hello', key));
    bytes[1] ^= 0xff;
    expect(() => decryptWithKey(toBase64(bytes), key)).toThrow(/MAC mismatch/);
  });

  it('rejects the wrong key', () => {
    const carol = new Uint8Array(32).fill(9);
    const payload = encrypt('secret', ALICE_SECRET, BOB_PUB);
    expect(() =>
      decrypt(payload, carol, ALICE_PUB)
    ).toThrow(/MAC mismatch/);
  });

  it('rejects an unknown version', () => {
    const bytes = base64ToBytes(encryptWithKey('hello', key));
    bytes[0] = 3;
    expect(() => decryptWithKey(toBase64(bytes), key)).toThrow(/version/);
  });

  it('names the reserved "#" encoding rather than failing as bad base64', () => {
    expect(() => decryptWithKey('#anything', key)).toThrow(/Unsupported NIP-44 encoding/);
  });

  it('rejects a truncated payload', () => {
    expect(() => decryptWithKey(toBase64(new Uint8Array(10)), key)).toThrow(/length/);
  });
});

describe('limits', () => {
  it('refuses an empty plaintext', () => {
    expect(() => encrypt('', ALICE_SECRET, BOB_PUB)).toThrow(/1\.\.65535/);
  });

  it('refuses a plaintext past the spec maximum', () => {
    expect(() => encrypt('x'.repeat(65_536), ALICE_SECRET, BOB_PUB)).toThrow(/1\.\.65535/);
  });
});

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}
