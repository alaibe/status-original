import type { DerivedKey } from '@/core/identity/keyring';
import { InMemoryMessageStore } from '@/core/messaging/message-store';
import type { ChatMessage, Conversation } from '@/core/messaging/types';
import { NostrSession } from './adapter';
import { encodeNpub } from '@/lib/bech32';
import { verifyEvent, type NostrEvent } from './events';
import type { HistoryState } from '@/core/messaging/history';
import { identityFromSecretKey, NOSTR_DERIVATION_PATH } from './keys';
import { conversationIdFor, wrapForRecipients } from './nip17';
import { fakeRelayFactory, type FakeRelay } from './testing/fake-relay';

/**
 * The Nostr transport end to end, against in-memory relays.
 *
 * This is the same bargain InMemoryChatSession makes for the store: if a real
 * transport cannot be driven without a network, the seam has leaked.
 */

const ALICE_SECRET = new Uint8Array(32).fill(1);
const alice = identityFromSecretKey(ALICE_SECRET);
const bob = identityFromSecretKey(new Uint8Array(32).fill(2));
const carol = identityFromSecretKey(new Uint8Array(32).fill(3));

/** Stands in for keyring.derive, which is all the adapter is given. */
function deriveFor(secret: Uint8Array) {
  return (path: string): DerivedKey => {
    expect(path).toBe(NOSTR_DERIVATION_PATH);
    return { path, privateKey: secret, publicKey: new Uint8Array(33) };
  };
}

async function connect(
  relayUrls = ['wss://a.example'],
  store = new InMemoryMessageStore(),
) {
  const factory = fakeRelayFactory();
  const session = await NostrSession.connect({
    derive: deriveFor(ALICE_SECRET),
    relays: relayUrls,
    createSocket: factory.create,
    store,
  });
  for (const relay of factory.relays) relay.open();
  return { session, factory };
}

/** Delivers a message from `sender` as the relays would. */
function deliverFrom(
  relay: FakeRelay,
  sender: typeof bob,
  recipients: string[],
  content: string,
  subject?: string
) {
  const { wraps } = wrapForRecipients(sender, { recipients, content, subject });
  for (const wrap of wraps) {
    if (wrap.tags[0][1] === alice.publicKey) relay.broadcast(wrap);
  }
}

const settleDeliveries = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('identity', () => {
  it('derives at the NIP-06 path and exposes the npub as the address', async () => {
    const { session } = await connect();

    expect(session.self.participantId).toBe(alice.publicKey);
    // There is no Ethereum address on this transport; the npub is the
    // human-facing identifier, so the UI has something to render.
    expect(session.self.address).toBe(encodeNpub(Uint8Array.from(hexBytes(alice.publicKey))));
    expect(session.self.address.startsWith('npub1')).toBe(true);
  });
});

describe('subscribing', () => {
  it('authenticates private history and reopens the request only after relay acceptance', async () => {
    const { session, factory } = await connect(['wss://a.example', 'wss://b.example']);
    const relay = factory.relays[0];
    relay.onmessage?.({ data: JSON.stringify(['AUTH', 'private-inbox-challenge']) });
    const auth = relay.sent.find((m) => m[0] === 'AUTH')![1] as NostrEvent;
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.pubkey).toBe(alice.publicKey);
    expect(auth.kind).toBe(22242);
    expect(auth.tags).toEqual([['relay', relay.url], ['challenge', 'private-inbox-challenge']]);
    expect(factory.relays[1].sent.some((m) => m[0] === 'AUTH')).toBe(false);
    expect(relay.published).toEqual([]);
    expect(relay.sent.filter((m) => m[0] === 'REQ')).toHaveLength(1);

    relay.onmessage?.({ data: JSON.stringify(['OK', auth.id, true, '']) });
    expect(relay.sent.filter((m) => m[0] === 'REQ')).toHaveLength(2);
    const subscription = String(relay.sent.find((m) => m[0] === 'REQ')![1]);
    for (const socket of factory.relays) socket.eose(subscription);
    await expect(session.sync()).resolves.toBeUndefined();
    await session.disconnect();
  });

  it('reports partial history when one relay finishes and another never responds', async () => {
    jest.useFakeTimers();
    try {
      const { session, factory } = await connect(['wss://a.example', 'wss://b.example']);
      let latest: HistoryState = { status: 'idle' };
      session.subscribeHistory((state) => { latest = state; });
      const syncing = session.sync();
      const rejected = expect(syncing).rejects.toThrow('1 of 2 relays');
      const subscription = String(factory.relays[0].sent.find((m) => m[0] === 'REQ')![1]);
      factory.relays[0].eose(subscription);
      await jest.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(latest.status).toBe('partial');
      await session.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for every relay to finish history, including sockets still connecting', async () => {
    const factory = fakeRelayFactory();
    const session = await NostrSession.connect({
      derive: deriveFor(ALICE_SECRET),
      relays: ['wss://a.example', 'wss://b.example'],
      createSocket: factory.create,
      store: new InMemoryMessageStore(),
    });
    let finished = false;
    const syncing = session.sync().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    for (const relay of factory.relays) relay.open();
    const subscription = String(factory.relays[0].sent.find((m) => m[0] === 'REQ')![1]);
    factory.relays[0].eose(subscription);
    await Promise.resolve();
    expect(finished).toBe(false);
    factory.relays[1].eose(subscription);
    await syncing;
    expect(finished).toBe(true);
    await session.disconnect();
  });

  it('times out silent relays, then retries with a fresh history request', async () => {
    jest.useFakeTimers();
    try {
      const { session, factory } = await connect();
      const syncing = session.sync();
      const rejected = expect(syncing).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(15_000);
      await rejected;
      const retry = session.sync();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const requests = factory.relays[0].sent.filter((m) => m[0] === 'REQ');
      expect(requests).toHaveLength(2);
      factory.relays[0].eose(String(requests[1][1]));
      await retry;
      await session.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles a pending history fetch on disconnect', async () => {
    const { session } = await connect();
    const syncing = session.sync();
    const rejected = expect(syncing).rejects.toThrow('disconnected');
    await session.disconnect();
    await rejected;
  });

  it('asks every relay for gift wraps addressed to us, and nothing else', async () => {
    const { factory } = await connect(['wss://a.example', 'wss://b.example']);

    for (const relay of factory.relays) {
      const req = relay.sent.find((m) => m[0] === 'REQ');
      expect(req).toBeDefined();
      const filter = (req as [string, string, Record<string, unknown>])[2];
      expect(filter.kinds).toEqual([1059]);
      expect(filter['#p']).toEqual([alice.publicKey]);
    }
  });
});

describe('receiving', () => {
  it('unwraps an incoming DM into a conversation and a message', async () => {
    const { session, factory } = await connect();

    const messages: ChatMessage[] = [];
    const conversations: Conversation[] = [];
    await session.streamMessages((m) => messages.push(m));
    await session.streamConversations((c) => conversations.push(c));

    deliverFrom(factory.relays[0], bob, [alice.publicKey], 'hello alice');
    await settleDeliveries();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual({ kind: 'text', text: 'hello alice' });
    expect(messages[0].senderId).toBe(bob.publicKey);
    expect(messages[0].fromMe).toBe(false);

    expect(conversations).toHaveLength(1);
    expect(conversations[0].kind).toBe('dm');
    expect(conversations[0].memberIds.sort()).toEqual([alice.publicKey, bob.publicKey].sort());
  });

  it('files a multi-recipient message as a group under its participant set', async () => {
    const { session, factory } = await connect();
    deliverFrom(factory.relays[0], bob, [alice.publicKey, carol.publicKey], 'hi both', 'Weekend');
    await settleDeliveries();

    const [conversation] = await session.listConversations();
    expect(conversation.kind).toBe('group');
    // NIP-17 has no thread id; a conversation *is* its participant set.
    expect(conversation.id).toBe(
      conversationIdFor([alice.publicKey, bob.publicKey, carol.publicKey])
    );
    expect(conversation.title).toBe('Weekend');
  });

  it('produces an id that is a legal conversation id', async () => {
    const { session, factory } = await connect();
    deliverFrom(factory.relays[0], bob, [alice.publicKey], 'hi');
    await settleDeliveries();

    const [conversation] = await session.listConversations();
    // The store will prefix this and the router will make it a path segment.
    expect(conversation.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ignores a wrap it cannot open, rather than failing the batch', async () => {
    const { session, factory } = await connect();

    const { wraps } = wrapForRecipients(bob, { recipients: [carol.publicKey], content: 'private' });
    factory.relays[0].broadcast(wraps[0]);
    deliverFrom(factory.relays[0], bob, [alice.publicKey], 'for me');
    await settleDeliveries();

    const conversations = await session.listConversations();
    expect(conversations).toHaveLength(1);
    expect((await session.getMessages(conversations[0].id))[0].content).toEqual({
      kind: 'text',
      text: 'for me',
    });
  });

  it('does not duplicate the same message arriving from two relays', async () => {
    const { session, factory } = await connect(['wss://a.example', 'wss://b.example']);

    const { wraps } = wrapForRecipients(bob, {
      recipients: [alice.publicKey],
      content: 'once please',
    });
    const forAlice = wraps.find((w) => w.tags[0][1] === alice.publicKey)!;
    factory.relays[0].broadcast(forAlice);
    factory.relays[1].broadcast(forAlice);
    await settleDeliveries();

    const [conversation] = await session.listConversations();
    expect(await session.getMessages(conversation.id)).toHaveLength(1);
  });

  it('orders by the rumor timestamp, not the jittered wrap timestamp', async () => {
    const { session, factory } = await connect();

    const older = wrapForRecipients(bob, {
      recipients: [alice.publicKey],
      content: 'first',
      createdAt: 1_000,
    });
    const newer = wrapForRecipients(bob, {
      recipients: [alice.publicKey],
      content: 'second',
      createdAt: 2_000,
    });

    // Delivered out of order, as relays do.
    factory.relays[0].broadcast(newer.wraps.find((w) => w.tags[0][1] === alice.publicKey)!);
    factory.relays[0].broadcast(older.wraps.find((w) => w.tags[0][1] === alice.publicKey)!);
    await settleDeliveries();

    const [conversation] = await session.listConversations();
    const messages = await session.getMessages(conversation.id);
    expect(messages.map((m) => textOf(m))).toEqual(['first', 'second']);
  });
});

describe('sending', () => {
  it('publishes one wrap per participant and records the message locally', async () => {
    const { session, factory } = await connect();
    const conversation = await session.createDm(bob.publicKey);

    const messages: ChatMessage[] = [];
    await session.streamMessages((m) => messages.push(m));

    await session.send(conversation.id, { kind: 'text', text: 'hi bob' });

    // Alice and Bob: without the self-addressed copy she cannot read her own
    // outbox on another device.
    expect(factory.relays[0].published).toHaveLength(2);
    expect(factory.relays[0].published.every((e) => e.kind === 1059)).toBe(true);

    // Recorded immediately rather than waiting for the relay to echo it back.
    expect(messages).toHaveLength(1);
    expect(messages[0].fromMe).toBe(true);
    expect(textOf(messages[0])).toBe('hi bob');
  });

  it('fails loudly when no relay accepted it', async () => {
    const factory = fakeRelayFactory();
    const session = await NostrSession.connect({
      derive: deriveFor(ALICE_SECRET),
      relays: ['wss://a.example'],
      createSocket: factory.create,
      store: new InMemoryMessageStore(),
    });
    // Never opened: nothing is connected.
    const conversation = await session.createDm(bob.publicKey);

    await expect(
      session.send(conversation.id, { kind: 'text', text: 'lost' })
    ).rejects.toThrow(/No relay accepted/);
  });

  it('retries only the unresolved wrap with stable rumor and wrap ids', async () => {
    const { session, factory } = await connect();
    const relay = factory.relays[0];
    relay.autoAcceptPublications = false;
    const conversation = await session.createDm(bob.publicKey);

    const first = session.send(conversation.id, { kind: 'text', text: 'once' });
    await settleDeliveries();
    const accepted = relay.published[0];
    relay.acknowledge(accepted.id, true);
    await settleDeliveries();
    const rejected = relay.published[1];
    relay.acknowledge(rejected.id, false, 'offline');
    await expect(first).rejects.toThrow('offline');

    const retry = session.send(conversation.id, { kind: 'text', text: 'once' });
    await settleDeliveries();
    expect(relay.published.map((event) => event.id)).toEqual([
      accepted.id,
      rejected.id,
      rejected.id,
    ]);
    relay.acknowledge(rejected.id, true);
    await retry;

    expect(await session.getMessages(conversation.id)).toHaveLength(1);
  });

  it('retries failed local persistence without publishing a second logical message', async () => {
    class FlakyStore extends InMemoryMessageStore {
      attempts = 0;
      override async insertMessage(...args: Parameters<InMemoryMessageStore['insertMessage']>) {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error('disk full');
        return super.insertMessage(...args);
      }
    }
    const { session, factory } = await connect(['wss://a.example'], new FlakyStore());
    const conversation = await session.createDm(bob.publicKey);

    await expect(session.send(conversation.id, { kind: 'text', text: 'persist me' }))
      .rejects.toThrow('disk full');
    const publishedIds = factory.relays[0].published.map((event) => event.id);

    await expect(session.send(conversation.id, { kind: 'text', text: 'persist me' }))
      .resolves.toBeTruthy();
    expect(factory.relays[0].published.map((event) => event.id)).toEqual(publishedIds);
    expect(await session.getMessages(conversation.id)).toHaveLength(1);
  });

  it('refuses content types it cannot carry, rather than sending a stub', async () => {
    const { session } = await connect();
    const conversation = await session.createDm(bob.publicKey);

    await expect(
      session.send(conversation.id, { kind: 'custom', typeId: 'eth.tx', data: {} })
    ).rejects.toThrow(/can only send text/);
  });

  it('rejects reply metadata instead of silently sending a plain message', async () => {
    const { session, factory } = await connect();
    const conversation = await session.createDm(bob.publicKey);

    await expect(
      session.send(conversation.id, { kind: 'text', text: 'reply' }, 'earlier-id')
    ).rejects.toThrow(/does not support reply metadata/);
    expect(factory.relays[0].published).toHaveLength(0);
  });

  it('round-trips to the recipient', async () => {
    // The real proof: what Alice publishes, Bob can open.
    const { session, factory } = await connect();
    const conversation = await session.createDm(bob.publicKey);
    await session.send(conversation.id, { kind: 'text', text: 'end to end' });

    const bobFactory = fakeRelayFactory();
    const bobSession = await NostrSession.connect({
      derive: deriveFor(new Uint8Array(32).fill(2)),
      relays: ['wss://a.example'],
      createSocket: bobFactory.create,
      store: new InMemoryMessageStore(),
    });
    bobFactory.relays[0].open();

    for (const event of factory.relays[0].published) {
      if (event.tags[0][1] === bob.publicKey) bobFactory.relays[0].broadcast(event);
    }
    await settleDeliveries();

    const [received] = await bobSession.listConversations();
    expect(textOf((await bobSession.getMessages(received.id))[0])).toBe('end to end');
  });
});

describe('catch-up cursor', () => {
  it('advances from the outer gift-wrap clock, not the rumor clock', async () => {
    const store = new InMemoryMessageStore();
    const { session, factory } = await connect(['wss://a.example'], store);
    const wrapped = wrapForRecipients(bob, {
      recipients: [alice.publicKey],
      content: 'future sender clock',
      createdAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    });
    const giftWrap = wrapped.wraps.find((event) => event.tags[0][1] === alice.publicKey)!;
    factory.relays[0].broadcast(giftWrap);
    await settleDeliveries();

    const [conversation] = await session.listConversations();
    expect((await session.getMessages(conversation.id))[0].sentAt).toBe(wrapped.rumor.created_at * 1000);
    await expect(store.newestTransportTimestamp('nostr', Date.now())).resolves.toBe(giftWrap.created_at * 1000);
  });

  it('ignores a persisted sender timestamp beyond the trusted local clock', async () => {
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1_000;
    const participants = [alice.publicKey, bob.publicKey].sort();
    const conversationId = conversationIdFor(participants);
    const store = new InMemoryMessageStore();
    await store.upsertConversation({
      id: conversationId,
      protocolId: 'nostr',
      participants,
      createdAt: old,
      hidden: false,
    });
    await store.insertMessage(storedMessage(conversationId, 'old', old), {
      id: conversationId,
      protocolId: 'nostr',
      participants,
      createdAt: old,
      hidden: false,
    }, old);
    await store.insertMessage(storedMessage(conversationId, 'poison', now + 365 * 24 * 60 * 60 * 1_000));

    const factory = fakeRelayFactory();
    const session = await NostrSession.connect({
      derive: deriveFor(ALICE_SECRET),
      relays: ['wss://a.example'],
      createSocket: factory.create,
      store,
    });
    factory.relays[0].open();
    const filter = factory.relays[0].sent.find((message) => message[0] === 'REQ')![2] as { since: number };

    expect(filter.since).toBe(Math.floor(old / 1_000) - 3 * 24 * 60 * 60);
    await session.disconnect();
  });
});

describe('groups, honestly', () => {
  it('reports every participant as a plain member, because there are no roles', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bob.publicKey, carol.publicKey], 'Trip');

    const members = await session.getMembers(group.id);
    expect(members.map((m) => m.role)).toEqual(['member', 'member', 'member']);
    // Claiming an owner would make the UI offer destructive actions that do
    // nothing.
    expect(group.selfRole).toBeUndefined();
  });

  it('refuses addMembers instead of silently forking the conversation', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bob.publicKey], 'Duo');

    await expect(session.addMembers(group.id, [carol.publicKey])).rejects.toThrow(
      /no roster to add to/
    );
  });

  it('refuses removeMembers, because nothing revokes access', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bob.publicKey], 'Duo');

    await expect(session.removeMembers(group.id, [bob.publicKey])).rejects.toThrow(
      /cannot remove anyone/
    );
  });

  it('leaves locally, and un-hides when someone replies', async () => {
    // Not XMTP's "rejoining needs a fresh invite": nobody is told, and any of
    // them can address the next message to you again.
    const { session, factory } = await connect();
    const group = await session.createGroup([bob.publicKey], 'Duo');

    await session.leaveGroup(group.id);
    expect(await session.listConversations()).toHaveLength(0);

    deliverFrom(factory.relays[0], bob, [alice.publicKey], 'still here');
    await settleDeliveries();
    expect(await session.listConversations()).toHaveLength(1);
  });

  it('renames locally; the name travels on the next message', async () => {
    const { session, factory } = await connect();
    const group = await session.createGroup([bob.publicKey, carol.publicKey], 'Old');

    await session.renameGroup(group.id, 'New');
    await session.send(group.id, { kind: 'text', text: 'renamed' });

    // The rename travels as a `subject` tag on the next message; there is no
    // rename event in NIP-17.
    expect(factory.relays[0].published[0].kind).toBe(1059);
    const [conversation] = await session.listConversations();
    expect(conversation.title).toBe('New');
  });
});

describe('resolving peers', () => {
  it('accepts an npub or hex, and rejects an Ethereum address', async () => {
    const { session } = await connect();

    expect(await session.resolvePeer(bob.npub)).toBe(bob.publicKey);
    expect(await session.resolvePeer(bob.publicKey)).toBe(bob.publicKey);
    expect(await session.resolvePeer('0x1111111111111111111111111111111111111111')).toBeNull();
  });

  it('labels participants with their npub, the only honest name available', async () => {
    const { session } = await connect();
    expect(await session.resolveAddresses([bob.publicKey])).toEqual({
      [bob.publicKey]: bob.npub,
    });
  });
});

describe('teardown', () => {
  it('closes every relay socket', async () => {
    const { session, factory } = await connect(['wss://a.example', 'wss://b.example']);
    await session.disconnect();
    expect(factory.relays.every((r) => r.closed)).toBe(true);
  });

});

function textOf(message: ChatMessage): string {
  return message.content.kind === 'text' ? message.content.text : '';
}

function hexBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function storedMessage(conversationId: string, id: string, sentAt: number): ChatMessage {
  return {
    id,
    conversationId,
    senderId: bob.publicKey,
    sentAt,
    fromMe: false,
    status: 'sent',
    content: { kind: 'text', text: id },
  };
}
