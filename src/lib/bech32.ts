import { fromHex, toHex } from './bytes';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = convertBits(data, 8, 5, true);
  if (!words) throw new Error('Could not convert to bech32 words');

  const checksum = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check: number[] = [];
  for (let i = 0; i < 6; i++) check.push((checksum >> (5 * (5 - i))) & 31);

  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join('')}`;
}

export interface Bech32Decoded {
  hrp: string;
  data: Uint8Array;
}

export function bech32Decode(value: string): Bech32Decoded | null {
  const input = value.trim();
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;

  const lower = input.toLowerCase();
  const split = lower.lastIndexOf('1');
  if (split < 1 || split + 7 > lower.length || lower.length > 5000) return null;

  const hrp = lower.slice(0, split);
  const words: number[] = [];
  for (const char of lower.slice(split + 1)) {
    const index = CHARSET.indexOf(char);
    if (index === -1) return null;
    words.push(index);
  }

  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null;

  const bytes = convertBits(words.slice(0, -6), 5, 8, false);
  if (!bytes) return null;
  return { hrp, data: Uint8Array.from(bytes) };
}

export function encodeNpub(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error('A Nostr public key is 32 bytes');
  return bech32Encode('npub', publicKey);
}

export function encodeNsec(secretKey: Uint8Array): string {
  if (secretKey.length !== 32) throw new Error('A Nostr secret key is 32 bytes');
  return bech32Encode('nsec', secretKey);
}

const HEX_PUBLIC_KEY = /^[0-9a-f]{64}$/i;

export function parsePublicKey(value: string): string | null {
  const trimmed = value.trim();
  if (HEX_PUBLIC_KEY.test(trimmed)) return trimmed.toLowerCase();

  const decoded = bech32Decode(trimmed);
  if (!decoded || decoded.hrp !== 'npub' || decoded.data.length !== 32) return null;
  return toHex(decoded.data);
}

export function npubFor(publicKeyHex: string): string | undefined {
  return HEX_PUBLIC_KEY.test(publicKeyHex) ? encodeNpub(fromHex(publicKeyHex)) : undefined;
}
