/**
 * NIP-17 private messages over NIP-59 gift wrapping. Three layers: an
 * unsigned kind 14 rumor (unsigned so it cannot be republished as proof you
 * said something), a kind 13 seal that proves authorship, and a kind 1059
 * wrap under a throwaway key, which is all a relay ever sees. One wrap per
 * recipient including yourself, or you cannot read your own outbox.
 *
 * What it does NOT give you, and the UI must not imply: a roster, membership
 * enforcement, or deniable delivery: relays still see one wrap per
 * recipient, so a conversation's size leaks.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  nowSeconds,
  signEvent,
  tagValues,
  verifyEvent,
  withId,
  type NostrEvent,
  type Rumor,
  type Tag,
} from './events';
import { ephemeralIdentity, type NostrIdentity } from './keys';
import { decrypt, encrypt } from '@/lib/nip44';
import { randomInt } from '@/lib/random';

export const KIND_DM = 14;
export const KIND_SEAL = 13;
export const KIND_GIFT_WRAP = 1059;

const MAX_JITTER_SECONDS = 2 * 24 * 60 * 60;

function jitteredTimestamp(): number {
  return nowSeconds() - randomInt(MAX_JITTER_SECONDS);
}

export interface DirectMessage {
  recipients: string[];
  content: string;
  subject?: string;
  tags?: Tag[];
  createdAt?: number;
}

export function buildRumor(sender: NostrIdentity, message: DirectMessage): Rumor {
  const tags: Tag[] = message.recipients.map((pubkey) => ['p', pubkey]);
  if (message.subject) tags.push(['subject', message.subject]);
  if (message.tags) tags.push(...message.tags);

  return withId({
    pubkey: sender.publicKey,
    created_at: message.createdAt ?? nowSeconds(),
    kind: KIND_DM,
    tags,
    content: message.content,
  });
}

export function sealRumor(rumor: Rumor, sender: NostrIdentity, recipientPubkey: string): NostrEvent {
  return signEvent(
    {
      pubkey: sender.publicKey,
      created_at: jitteredTimestamp(),
      kind: KIND_SEAL,
      tags: [],
      content: encrypt(JSON.stringify(rumor), sender.secretKey, recipientPubkey),
    },
    sender.secretKey
  );
}

export function giftWrap(seal: NostrEvent, recipientPubkey: string): NostrEvent {
  const ephemeral = ephemeralIdentity();
  return signEvent(
    {
      pubkey: ephemeral.publicKey,
      created_at: jitteredTimestamp(),
      kind: KIND_GIFT_WRAP,
      tags: [['p', recipientPubkey]],
      content: encrypt(JSON.stringify(seal), ephemeral.secretKey, recipientPubkey),
    },
    ephemeral.secretKey
  );
}

export function wrapForRecipients(
  sender: NostrIdentity,
  message: DirectMessage
): { rumor: Rumor; wraps: NostrEvent[] } {
  const rumor = buildRumor(sender, message);
  const audience = [...new Set([...message.recipients, sender.publicKey])];

  return {
    rumor,
    wraps: audience.map((pubkey) => giftWrap(sealRumor(rumor, sender, pubkey), pubkey)),
  };
}

export function unwrapGiftWrap(wrap: NostrEvent, recipient: NostrIdentity): Rumor | null {
  try {
    if (wrap.kind !== KIND_GIFT_WRAP) return null;
    if (!verifyEvent(wrap)) return null;

    const sealJson = decrypt(wrap.content, recipient.secretKey, wrap.pubkey);
    const seal = JSON.parse(sealJson) as NostrEvent;
    if (seal.kind !== KIND_SEAL || !verifyEvent(seal)) return null;

    const rumorJson = decrypt(seal.content, recipient.secretKey, seal.pubkey);
    const rumor = JSON.parse(rumorJson) as Rumor;
    if (rumor.kind !== KIND_DM) return null;
    if (rumor.pubkey !== seal.pubkey) return null;
    if (withId(rumor).id !== rumor.id) return null;
    if (rumor.pubkey !== recipient.publicKey && !tagValues(rumor, 'p').includes(recipient.publicKey)) {
      return null;
    }

    return rumor;
  } catch {
    return null;
  }
}

export function conversationIdFor(participants: string[]): string {
  const sorted = [...new Set(participants)].sort();
  return bytesToHex(sha256(utf8ToBytes(sorted.join(','))));
}

export function participantsOf(rumor: Rumor): string[] {
  return [...new Set([rumor.pubkey, ...tagValues(rumor, 'p')])].sort();
}
