import { chacha20 } from '@noble/ciphers/chacha';
import { secp256k1 } from '@noble/curves/secp256k1';
import { expand as hkdfExpand, extract as hkdfExtract } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';

import { randomBytes } from './random';

const VERSION = 2;
const SALT = utf8ToBytes('nip44-v2');
const MIN_PLAINTEXT = 1;
const MAX_PLAINTEXT = 65_535;

export function conversationKey(secretKey: Uint8Array, publicKeyHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(secretKey, `02${publicKeyHex}`);
  return conversationKeyFromSharedX(shared.subarray(1, 33));
}

export function conversationKeyFromSharedX(sharedX: Uint8Array): Uint8Array {
  return hkdfExtract(sha256, sharedX, SALT);
}

interface MessageKeys {
  chachaKey: Uint8Array;
  chachaNonce: Uint8Array;
  hmacKey: Uint8Array;
}

function messageKeys(convKey: Uint8Array, nonce: Uint8Array): MessageKeys {
  const material = hkdfExpand(sha256, convKey, nonce, 76);
  return {
    chachaKey: material.subarray(0, 32),
    chachaNonce: material.subarray(32, 44),
    hmacKey: material.subarray(44, 76),
  };
}

export function calcPaddedLen(unpadded: number): number {
  if (unpadded <= 0) throw new Error('Cannot pad an empty plaintext');
  if (unpadded <= 32) return 32;

  const nextPower = 1 << (Math.floor(Math.log2(unpadded - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((unpadded - 1) / chunk) + 1);
}

function pad(plaintext: string): Uint8Array {
  const bytes = utf8ToBytes(plaintext);
  if (bytes.length < MIN_PLAINTEXT || bytes.length > MAX_PLAINTEXT) {
    throw new Error(`NIP-44 plaintext must be 1..${MAX_PLAINTEXT} bytes, got ${bytes.length}`);
  }

  const prefix = new Uint8Array(2);
  new DataView(prefix.buffer).setUint16(0, bytes.length, false);
  const padding = new Uint8Array(calcPaddedLen(bytes.length) - bytes.length);
  return concatBytes(prefix, bytes, padding);
}

function unpad(padded: Uint8Array): string {
  if (padded.length < 2) throw new Error('Malformed NIP-44 padding');

  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(0, false);
  const content = padded.subarray(2, 2 + length);

  if (
    length < MIN_PLAINTEXT ||
    content.length !== length ||
    padded.length !== 2 + calcPaddedLen(length)
  ) {
    throw new Error('Malformed NIP-44 padding');
  }
  return new TextDecoder().decode(content);
}

export function encryptWithKey(plaintext: string, convKey: Uint8Array, nonce?: Uint8Array): string {
  const messageNonce = nonce ?? randomBytes(32);
  if (messageNonce.length !== 32) throw new Error('A NIP-44 nonce is 32 bytes');

  const keys = messageKeys(convKey, messageNonce);
  const ciphertext = chacha20(keys.chachaKey, keys.chachaNonce, pad(plaintext));
  const mac = hmac(sha256, keys.hmacKey, concatBytes(messageNonce, ciphertext));

  return bytesToBase64(concatBytes(Uint8Array.of(VERSION), messageNonce, ciphertext, mac));
}

export function decryptWithKey(payload: string, convKey: Uint8Array): string {
  if (payload.startsWith('#')) {
    throw new Error('Unsupported NIP-44 encoding');
  }

  const bytes = base64ToBytes(payload);
  if (bytes.length < 99 || bytes.length > 65_603) {
    throw new Error(`Invalid NIP-44 payload length: ${bytes.length}`);
  }
  if (bytes[0] !== VERSION) {
    throw new Error(`Unsupported NIP-44 version: ${bytes[0]}`);
  }

  const nonce = bytes.subarray(1, 33);
  const ciphertext = bytes.subarray(33, bytes.length - 32);
  const mac = bytes.subarray(bytes.length - 32);

  const keys = messageKeys(convKey, nonce);
  const expected = hmac(sha256, keys.hmacKey, concatBytes(nonce, ciphertext));
  if (!timingSafeEqual(expected, mac)) throw new Error('NIP-44 MAC mismatch');

  return unpad(chacha20(keys.chachaKey, keys.chachaNonce, ciphertext));
}

export function encrypt(plaintext: string, secretKey: Uint8Array, publicKeyHex: string): string {
  return encryptWithKey(plaintext, conversationKey(secretKey, publicKeyHex));
}

export function decrypt(payload: string, secretKey: Uint8Array, publicKeyHex: string): string {
  return decryptWithKey(payload, conversationKey(secretKey, publicKeyHex));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
