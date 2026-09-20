/**
 * Payload encryption for Waku. The node is trusted for delivery and nothing
 * else, so payloads are sealed before they leave the device.
 *
 * This is not js-waku's `version: 1` encryption, and no other Waku client
 * will decrypt it. It is NIP-44 v2's sealed box, reused rather than
 * reimplemented, because a subtly wrong copy of Waku's own wire format would
 * be worse than an honestly named app-specific one. Every message is signed
 * too: a content topic is a public string and grants no authorship.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  base64ToBytes,
  bytesToBase64,
  conversationKeyFromSharedX,
  decryptWithKey,
  encryptWithKey,
} from '@/lib/nip44';
import { randomBytes } from '@/lib/random';

export const ENVELOPE_VERSION = 1;

export interface WakuEnvelope {
  v: number;
  from: string;
  ts: number;
  box: string;
  epk: string;
  sig: string;
}

export function sealEnvelope(
  plaintext: string,
  senderSecretKey: Uint8Array,
  recipientPublicKeyHex: string
): WakuEnvelope {
  const ephemeralSecret = randomBytes(32);
  const ephemeralPublic = secp256k1.getPublicKey(ephemeralSecret, true);

  const box = encryptWithKey(plaintext, sharedKey(ephemeralSecret, recipientPublicKeyHex));

  const envelope: Omit<WakuEnvelope, 'sig'> = {
    v: ENVELOPE_VERSION,
    from: bytesToHex(schnorr.getPublicKey(senderSecretKey)),
    ts: Date.now(),
    box,
    epk: bytesToHex(ephemeralPublic),
  };

  return { ...envelope, sig: bytesToHex(schnorr.sign(signingDigest(envelope), senderSecretKey)) };
}

export function openEnvelope(
  envelope: WakuEnvelope,
  recipientSecretKey: Uint8Array
): { plaintext: string; sender: string; sentAt: number } | null {
  try {
    if (envelope?.v !== ENVELOPE_VERSION) return null;
    if (!/^[0-9a-f]{64}$/i.test(envelope.from)) return null;

    const { sig, ...signed } = envelope;
    if (!schnorr.verify(sig, signingDigest(signed), envelope.from)) return null;

    const plaintext = decryptWithKey(
      envelope.box,
      sharedKeyFromCompressed(recipientSecretKey, envelope.epk)
    );
    return { plaintext, sender: envelope.from, sentAt: envelope.ts };
  } catch {
    return null;
  }
}

export function encodeEnvelope(envelope: WakuEnvelope): string {
  return bytesToBase64(utf8ToBytes(JSON.stringify(envelope)));
}

export function decodeEnvelope(payloadBase64: string): WakuEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(payloadBase64)));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as WakuEnvelope;
  } catch {
    return null;
  }
}

export function contentTopicFor(participants: string[]): string {
  const sorted = [...new Set(participants)].sort();
  const digest = bytesToHex(sha256(utf8ToBytes(`status-original:waku:${sorted.join(',')}`)));
  return `/status-original/1/c-${digest.slice(0, 32)}/proto`;
}

export function conversationIdForTopic(contentTopic: string): string {
  return bytesToHex(sha256(utf8ToBytes(contentTopic)));
}

function signingDigest(envelope: Omit<WakuEnvelope, 'sig'>): Uint8Array {
  return sha256(
    utf8ToBytes(`${envelope.v}|${envelope.from}|${envelope.ts}|${envelope.box}|${envelope.epk}`)
  );
}

function sharedKey(secretKey: Uint8Array, xOnlyPublicKeyHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(secretKey, `02${xOnlyPublicKeyHex}`);
  return conversationKeyFromSharedX(shared.subarray(1, 33));
}

function sharedKeyFromCompressed(secretKey: Uint8Array, compressedHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(secretKey, compressedHex);
  return conversationKeyFromSharedX(shared.subarray(1, 33));
}
