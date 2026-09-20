import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import { NATIVE_ID } from '@/core/messaging/namespace';
import {
  contentTopicFor,
  conversationIdForTopic,
  decodeEnvelope,
  encodeEnvelope,
  openEnvelope,
  sealEnvelope,
} from './crypto';

const ALICE = new Uint8Array(32).fill(1);
const BOB = new Uint8Array(32).fill(2);
const MALLORY = new Uint8Array(32).fill(9);

const alicePub = bytesToHex(schnorr.getPublicKey(ALICE));
const bobPub = bytesToHex(schnorr.getPublicKey(BOB));

describe('sealed envelopes', () => {
  it('round-trips to the intended recipient', () => {
    const envelope = sealEnvelope('hello waku', ALICE, bobPub);
    const opened = openEnvelope(envelope, BOB);

    expect(opened?.plaintext).toBe('hello waku');
    expect(opened?.sender).toBe(alicePub);
  });

  it('is opaque to everyone else', () => {
    // A content topic is public, so every subscriber sees every envelope.
    const envelope = sealEnvelope('for bob only', ALICE, bobPub);
    expect(openEnvelope(envelope, MALLORY)).toBeNull();
  });

  it('never puts the plaintext on the wire', () => {
    const envelope = sealEnvelope('a distinctive phrase', ALICE, bobPub);
    expect(encodeEnvelope(envelope)).not.toContain('distinctive');
    expect(JSON.stringify(envelope)).not.toContain('distinctive');
  });

  it('uses a fresh ephemeral key each time', () => {
    // Static-static ECDH would mean one leaked long-term key opens everything
    // still sitting in the node's store.
    const a = sealEnvelope('same text', ALICE, bobPub);
    const b = sealEnvelope('same text', ALICE, bobPub);
    expect(a.epk).not.toBe(b.epk);
    expect(a.box).not.toBe(b.box);
  });
});

describe('authorship', () => {
  it('rejects an envelope whose signature does not match its claimed sender', () => {
    // Without this, anyone who knows a topic could post as anyone else.
    const envelope = sealEnvelope('legitimate', ALICE, bobPub);
    const forged = { ...envelope, from: bytesToHex(schnorr.getPublicKey(MALLORY)) };
    expect(openEnvelope(forged, BOB)).toBeNull();
  });

  it('rejects a swapped ciphertext, because the signature covers it', () => {
    const mine = sealEnvelope('mine', ALICE, bobPub);
    const theirs = sealEnvelope('theirs', MALLORY, bobPub);
    expect(openEnvelope({ ...mine, box: theirs.box }, BOB)).toBeNull();
  });

  it('rejects a rewritten timestamp', () => {
    const envelope = sealEnvelope('now', ALICE, bobPub);
    expect(openEnvelope({ ...envelope, ts: envelope.ts + 1 }, BOB)).toBeNull();
  });

  it('rejects an unknown envelope version rather than guessing', () => {
    const envelope = sealEnvelope('hi', ALICE, bobPub);
    expect(openEnvelope({ ...envelope, v: 99 }, BOB)).toBeNull();
  });
});

describe('encoding', () => {
  it('survives base64 round-tripping through the node', () => {
    const envelope = sealEnvelope('héllo 🌍', ALICE, bobPub);
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    expect(decoded).toEqual(envelope);
    expect(openEnvelope(decoded!, BOB)?.plaintext).toBe('héllo 🌍');
  });

  it('returns null for junk rather than throwing mid-poll', () => {
    expect(decodeEnvelope('not base64 at all!!!')).toBeNull();
    expect(decodeEnvelope(globalThis.btoa('{"not":"an envelope"'))).toBeNull();
  });
});

describe('topics and ids', () => {
  it('derives the same topic from either side', () => {
    expect(contentTopicFor([alicePub, bobPub])).toBe(contentTopicFor([bobPub, alicePub]));
  });

  it('never puts a participant key in the topic, which is public', () => {
    const topic = contentTopicFor([alicePub, bobPub]);
    expect(topic).not.toContain(alicePub);
    expect(topic).not.toContain(bobPub);
    expect(topic.startsWith('/status-original/1/')).toBe(true);
  });

  it('hashes the topic into a conversation id that can be a URL segment', () => {
    // Topics contain slashes; conversation ids become `/chat/<id>`.
    const topic = contentTopicFor([alicePub, bobPub]);
    expect(topic).toContain('/');
    expect(NATIVE_ID.test(conversationIdForTopic(topic))).toBe(true);
  });
});
