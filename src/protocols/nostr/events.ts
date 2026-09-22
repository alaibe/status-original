import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export type Tag = string[];

export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: Tag[];
  content: string;
}

export interface NostrEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

export interface Rumor extends UnsignedEvent {
  id: string;
}

export function serializeEvent(event: UnsignedEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function eventId(event: UnsignedEvent): string {
  return bytesToHex(sha256(utf8ToBytes(serializeEvent(event))));
}

export function withId(event: UnsignedEvent): Rumor {
  return { ...event, id: eventId(event) };
}

export function signEvent(event: UnsignedEvent, secretKey: Uint8Array): NostrEvent {
  const id = eventId(event);
  return { ...event, id, sig: bytesToHex(schnorr.sign(id, secretKey)) };
}

export function verifyEvent(event: NostrEvent): boolean {
  try {
    if (eventId(event) !== event.id) return false;
    return schnorr.verify(event.sig, event.id, event.pubkey);
  } catch {
    return false;
  }
}

export function tagValues(event: UnsignedEvent, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && tag.length > 1).map((tag) => tag[1]);
}

export function firstTagValue(event: UnsignedEvent, name: string): string | undefined {
  return tagValues(event, name)[0];
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
