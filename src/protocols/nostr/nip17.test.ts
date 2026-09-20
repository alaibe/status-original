import { eventId, serializeEvent, signEvent, verifyEvent } from './events';
import { identityFromSecretKey } from './keys';
import {
  buildRumor,
  conversationIdFor,
  giftWrap,
  KIND_DM,
  KIND_GIFT_WRAP,
  KIND_SEAL,
  participantsOf,
  sealRumor,
  unwrapGiftWrap,
  wrapForRecipients,
} from './nip17';

const alice = identityFromSecretKey(new Uint8Array(32).fill(1));
const bob = identityFromSecretKey(new Uint8Array(32).fill(2));
const carol = identityFromSecretKey(new Uint8Array(32).fill(3));
const mallory = identityFromSecretKey(new Uint8Array(32).fill(9));

describe('event ids', () => {
  it('hash the canonical array, in the spec order', () => {
    const event = {
      pubkey: alice.publicKey,
      created_at: 1_700_000_000,
      kind: 1,
      tags: [['p', bob.publicKey]],
      content: 'hi',
    };
    expect(serializeEvent(event)).toBe(
      `[0,"${alice.publicKey}",1700000000,1,[["p","${bob.publicKey}"]],"hi"]`
    );
    expect(eventId(event)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field changes', () => {
    const base = { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content: 'a' };
    expect(eventId(base)).not.toBe(eventId({ ...base, content: 'b' }));
    expect(eventId(base)).not.toBe(eventId({ ...base, created_at: 2 }));
  });
});

describe('signing', () => {
  it('produces an event that verifies', () => {
    const event = signEvent(
      { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content: 'hi' },
      alice.secretKey
    );
    expect(verifyEvent(event)).toBe(true);
  });

  it('rejects an event whose content was rewritten after signing', () => {
    // The id is recomputed from the body before the signature is checked, so a
    // relay cannot swap the content of an otherwise valid event.
    const event = signEvent(
      { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content: 'hi' },
      alice.secretKey
    );
    expect(verifyEvent({ ...event, content: 'goodbye' })).toBe(false);
  });

  it('rejects a signature from someone else', () => {
    const event = signEvent(
      { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content: 'hi' },
      mallory.secretKey
    );
    expect(verifyEvent(event)).toBe(false);
  });
});

describe('gift wrapping a DM', () => {
  it('produces one wrap per participant, including the sender', () => {
    // Without a self-addressed copy you cannot read your own outbox on another
    // device or after a reinstall.
    const { wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'hello',
    });
    expect(wraps).toHaveLength(2);
    expect(wraps.every((w) => w.kind === KIND_GIFT_WRAP)).toBe(true);
  });

  it('signs each wrap with a fresh throwaway key, never the sender', () => {
    const { wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey, carol.publicKey],
      content: 'hello',
    });

    const authors = wraps.map((w) => w.pubkey);
    expect(authors).not.toContain(alice.publicKey);
    // Distinct per wrap: reusing one ephemeral key across recipients would let
    // a relay link them back into one message.
    expect(new Set(authors).size).toBe(authors.length);
    expect(wraps.every(verifyEvent)).toBe(true);
  });

  it('leaks only the recipient in a wrap tag, never the sender or content', () => {
    const { wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'a very distinctive phrase',
    });
    const forBob = wraps.find((w) => w.tags[0][1] === bob.publicKey)!;

    expect(JSON.stringify(forBob)).not.toContain('a very distinctive phrase');
    expect(JSON.stringify(forBob.tags)).not.toContain(alice.publicKey);
  });

  it('unwraps back to the original rumor', () => {
    const { rumor, wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'hello',
    });
    const forBob = wraps.find((w) => w.tags[0][1] === bob.publicKey)!;

    const opened = unwrapGiftWrap(forBob, bob);
    expect(opened?.content).toBe('hello');
    expect(opened?.pubkey).toBe(alice.publicKey);
    expect(opened?.id).toBe(rumor.id);
    expect(opened?.kind).toBe(KIND_DM);
  });

  it('lets the sender read their own copy', () => {
    const { wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'note to self about bob',
    });
    const forAlice = wraps.find((w) => w.tags[0][1] === alice.publicKey)!;
    expect(unwrapGiftWrap(forAlice, alice)?.content).toBe('note to self about bob');
  });

  it('returns null for a wrap addressed to someone else', () => {
    const { wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'private',
    });
    const forBob = wraps.find((w) => w.tags[0][1] === bob.publicKey)!;
    expect(unwrapGiftWrap(forBob, mallory)).toBeNull();
  });

  it('carries a group subject and every recipient as a p tag', () => {
    const { rumor } = wrapForRecipients(alice, {
      recipients: [bob.publicKey, carol.publicKey],
      content: 'hi both',
      subject: 'Weekend',
    });
    expect(rumor.tags).toContainEqual(['subject', 'Weekend']);
    expect(rumor.tags).toContainEqual(['p', bob.publicKey]);
    expect(rumor.tags).toContainEqual(['p', carol.publicKey]);
  });

  it('randomises wrap timestamps into the past, but not the rumor', () => {
    const now = Math.floor(Date.now() / 1000);
    const { rumor, wraps } = wrapForRecipients(alice, {
      recipients: [bob.publicKey],
      content: 'hi',
    });

    // The rumor's own time is what message ordering uses; the wrap's is jitter.
    expect(Math.abs(rumor.created_at - now)).toBeLessThanOrEqual(2);
    for (const wrap of wraps) {
      expect(wrap.created_at).toBeLessThanOrEqual(now);
      expect(now - wrap.created_at).toBeLessThanOrEqual(2 * 24 * 60 * 60);
    }
  });
});

describe('unwrapping refuses forgeries', () => {
  it('rejects a seal signed by someone other than the rumor author', () => {
    // Mallory wraps a rumor claiming to be from Alice. The seal is hers, so
    // the pubkey check catches it; without that check, anyone could
    // impersonate anyone by wrapping a rumor they made up.
    const forged = buildRumor(alice, { recipients: [bob.publicKey], content: 'transfer funds' });
    const seal = signEvent(
      {
        pubkey: mallory.publicKey,
        created_at: 1,
        kind: KIND_SEAL,
        tags: [],
        content: encryptTo(JSON.stringify(forged), mallory, bob.publicKey),
      },
      mallory.secretKey
    );
    const wrap = wrapAs(seal, bob.publicKey);

    expect(unwrapGiftWrap(wrap, bob)).toBeNull();
  });

  it('rejects a rumor whose id does not match its body', () => {
    const { wraps } = wrapForRecipients(alice, { recipients: [bob.publicKey], content: 'ok' });
    const forBob = wraps.find((w) => w.tags[0][1] === bob.publicKey)!;
    // Sanity: the honest one opens.
    expect(unwrapGiftWrap(forBob, bob)).not.toBeNull();

    const tampered = { ...forBob, content: forBob.content.slice(0, -4) + 'AAAA' };
    expect(unwrapGiftWrap(tampered, bob)).toBeNull();
  });

  it('rejects an event that is not a gift wrap at all', () => {
    const note = signEvent(
      { pubkey: alice.publicKey, created_at: 1, kind: 1, tags: [], content: 'public' },
      alice.secretKey
    );
    expect(unwrapGiftWrap(note, bob)).toBeNull();
  });

  it('rejects a validly signed rumor that does not address the recipient', () => {
    const rumor = buildRumor(alice, { recipients: [carol.publicKey], content: 'not for bob' });
    const wrap = giftWrap(sealRumor(rumor, alice, bob.publicKey), bob.publicKey);

    expect(unwrapGiftWrap(wrap, bob)).toBeNull();
  });
});

describe('conversation identity', () => {
  it('is the participant set, order-independent', () => {
    expect(conversationIdFor([alice.publicKey, bob.publicKey])).toBe(
      conversationIdFor([bob.publicKey, alice.publicKey])
    );
  });

  it('is hex, so it is a legal conversation id with no further encoding', () => {
    expect(conversationIdFor([alice.publicKey])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs once the set differs, which is why there is no "add member"', () => {
    const pair = conversationIdFor([alice.publicKey, bob.publicKey]);
    const trio = conversationIdFor([alice.publicKey, bob.publicKey, carol.publicKey]);
    expect(pair).not.toBe(trio);
  });

  it('derives the same set from either side of a group message', () => {
    const { rumor } = wrapForRecipients(alice, {
      recipients: [bob.publicKey, carol.publicKey],
      content: 'hi',
    });
    expect(participantsOf(rumor)).toEqual(
      [alice.publicKey, bob.publicKey, carol.publicKey].sort()
    );
  });
});

// --- helpers used only to build deliberately malformed events ---------------

function encryptTo(plaintext: string, from: typeof alice, toPublicKey: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { encrypt } = require('@/lib/nip44') as typeof import('@/lib/nip44');
  return encrypt(plaintext, from.secretKey, toPublicKey);
}

function wrapAs(seal: ReturnType<typeof signEvent>, recipientPublicKey: string) {
  const ephemeral = identityFromSecretKey(new Uint8Array(32).fill(11));
  return signEvent(
    {
      pubkey: ephemeral.publicKey,
      created_at: 1,
      kind: KIND_GIFT_WRAP,
      tags: [['p', recipientPublicKey]],
      content: encryptTo(JSON.stringify(seal), ephemeral, recipientPublicKey),
    },
    ephemeral.secretKey
  );
}
