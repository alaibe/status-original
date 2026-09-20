import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import {
  bech32Decode,
  bech32Encode,
  encodeNpub,
  encodeNsec,
  npubFor,
  parsePublicKey,
} from '@/lib/bech32';

describe('bech32', () => {
  it('round-trips arbitrary bytes', () => {
    const data = Uint8Array.from([0, 1, 2, 250, 255, 128]);
    const decoded = bech32Decode(bech32Encode('test', data));
    expect(decoded?.hrp).toBe('test');
    expect([...(decoded?.data ?? [])]).toEqual([...data]);
  });

  it('rejects a corrupted checksum', () => {
    const encoded = bech32Encode('npub', new Uint8Array(32).fill(7));
    const broken = `${encoded.slice(0, -1)}${encoded.at(-1) === 'q' ? 'p' : 'q'}`;
    expect(bech32Decode(broken)).toBeNull();
  });

  it('rejects mixed case, as BIP-173 requires', () => {
    const encoded = bech32Encode('npub', new Uint8Array(32).fill(7));
    expect(bech32Decode(encoded.toUpperCase())).not.toBeNull();
    expect(bech32Decode(`NPUB${encoded.slice(4)}`)).toBeNull();
  });

  it('rejects a character outside the charset', () => {
    expect(bech32Decode('npub1bbbbb')).toBeNull();
  });
});

describe('nostr entities', () => {
  const secret = new Uint8Array(32).fill(5);
  const publicKey = schnorr.getPublicKey(secret);

  it('encodes an npub with the right prefix and length', () => {
    const npub = encodeNpub(publicKey);
    expect(npub.startsWith('npub1')).toBe(true);
    // 32 bytes -> 52 data chars + 6 checksum + 'npub1'
    expect(npub).toHaveLength(63);
  });

  it('encodes an nsec', () => {
    expect(encodeNsec(secret).startsWith('nsec1')).toBe(true);
  });

  it('refuses a key of the wrong length rather than encoding nonsense', () => {
    expect(() => encodeNpub(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('parsePublicKey', () => {
  const secret = new Uint8Array(32).fill(5);
  const hex = bytesToHex(schnorr.getPublicKey(secret));

  it('accepts the npub form people actually paste', () => {
    expect(parsePublicKey(encodeNpub(schnorr.getPublicKey(secret)))).toBe(hex);
  });

  it('accepts bare hex, in either case, and normalises it', () => {
    expect(parsePublicKey(hex.toUpperCase())).toBe(hex);
    expect(parsePublicKey(`  ${hex}  `)).toBe(hex);
  });

  it('rejects an Ethereum address, which means nothing here', () => {
    expect(parsePublicKey('0x1111111111111111111111111111111111111111')).toBeNull();
  });

  it('rejects an nsec, so a pasted secret key is never used as a recipient', () => {
    // Worth its own case: someone pasting their own nsec into a "who do you
    // want to message" field would otherwise silently address a key derived
    // from their secret.
    expect(parsePublicKey(encodeNsec(secret))).toBeNull();
  });

  it('rejects the TLV entities this deliberately does not implement', () => {
    expect(parsePublicKey('nprofile1qqsxyz')).toBeNull();
  });
});

describe('npubFor', () => {
  const publicKey = schnorr.getPublicKey(new Uint8Array(32).fill(5));
  const hex = bytesToHex(publicKey);

  it('is the inverse of parsePublicKey', () => {
    expect(npubFor(hex)).toBe(encodeNpub(publicKey));
    expect(parsePublicKey(npubFor(hex) ?? '')).toBe(hex);
  });

  it('accepts either case', () => {
    expect(npubFor(hex.toUpperCase())).toBe(encodeNpub(publicKey));
  });

  it('returns nothing for anything but a 64-hex key', () => {
    expect(npubFor('0x1111111111111111111111111111111111111111')).toBeUndefined();
    expect(npubFor(encodeNpub(publicKey))).toBeUndefined();
  });
});
