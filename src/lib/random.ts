import * as Crypto from 'expo-crypto';

export function randomBytes(length: number): Uint8Array {
  return Crypto.getRandomBytes(length);
}

export function randomInt(max: number): number {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const bytes = randomBytes(4);
    const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (value < limit) return value % max;
  }
}
