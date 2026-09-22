import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import type { DerivedKey } from '@/core/identity/keyring';
import { InMemoryMessageStore, type MessageStore } from '@/core/messaging/message-store';
import { NATIVE_ID } from '@/core/messaging/namespace';
import type { ChatMessage } from '@/core/messaging/types';
import { WakuSession, WAKU_DERIVATION_PATH } from './adapter';
import { contentTopicFor, conversationIdForTopic, encodeEnvelope, sealEnvelope } from './crypto';
import { FakeWakuNode } from './testing/fake-node';
import { WAKU_PROTOCOL } from './descriptor';

const ALICE = new Uint8Array(32).fill(1);
const BOB = new Uint8Array(32).fill(2);
const CAROL = new Uint8Array(32).fill(3);

const alicePub = bytesToHex(schnorr.getPublicKey(ALICE));
const bobPub = bytesToHex(schnorr.getPublicKey(BOB));
const carolPub = bytesToHex(schnorr.getPublicKey(CAROL));

const NODE = 'http://127.0.0.1:8645';

function deriveFor(secret: Uint8Array) {
  return (path: string): DerivedKey => {
    expect(path).toBe(WAKU_DERIVATION_PATH);
    return { path, privateKey: secret, publicKey: new Uint8Array(33) };
  };
}

async function connect(
  node = new FakeWakuNode(),
  secret = ALICE,
  store: MessageStore = new InMemoryMessageStore()
) {
  const session = await WakuSession.connect({
    derive: deriveFor(secret),
    nodeUrl: NODE,
    fetchImpl: node.fetch,
    // Driven by hand: a 4-second interval is not something to wait on.
    autoPoll: false,
    store,
  });
  return { session, node };
}

/** Lets the background subscribe-and-backfill settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('connecting', () => {
  it('checks the node is reachable, so a bad URL fails here not on first send', async () => {
    const node = new FakeWakuNode();
    node.down = true;

    await expect(
      WakuSession.connect({
        derive: deriveFor(ALICE),
        nodeUrl: NODE,
        fetchImpl: node.fetch,
        store: new InMemoryMessageStore(),
      })
    ).rejects.toThrow();
  });

  it('rejects a URL that is not http(s)', async () => {
    await expect(
      WakuSession.connect({
        derive: deriveFor(ALICE),
        nodeUrl: 'ws://nope',
        store: new InMemoryMessageStore(),
      })
    ).rejects.toThrow(/must start with http/);
  });

  it('ships no default node, so the caller must supply one', async () => {
    await expect(
      WakuSession.connect({
        derive: deriveFor(ALICE),
        nodeUrl: '',
        store: new InMemoryMessageStore(),
      })
    ).rejects.toThrow(/must start with http/);
  });
});

describe('conversations', () => {
  it('subscribes to the topic for the participant set', async () => {
    const { session, node } = await connect();
    await session.createDm(bobPub);
    await settle();

    expect([...node.subscriptions]).toEqual([contentTopicFor([alicePub, bobPub])]);
  });

  it('produces a conversation id that can be a URL path segment', async () => {
    const { session } = await connect();
    const conversation = await session.createDm(bobPub);
    expect(NATIVE_ID.test(conversation.id)).toBe(true);
  });

  it('treats three participants as a group', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bobPub, carolPub], 'Trip');
    expect(group.kind).toBe('group');
    expect(group.title).toBe('Trip');
  });
});

describe('sending and receiving', () => {
  it('publishes one sealed copy per participant, self included', async () => {
    const { session, node } = await connect();
    const conversation = await session.createDm(bobPub);
    await settle();

    await session.send(conversation.id, { kind: 'text', text: 'hi bob' });

    expect(node.published).toHaveLength(2);
    // Nothing readable on the wire.
    expect(JSON.stringify(node.published)).not.toContain('hi bob');
  });

  it('reads back its own message on the next poll', async () => {
    // The self-addressed copy is what makes the outbox readable after a
    // restart, when everything is re-fetched from the node's store.
    const { session } = await connect();
    const conversation = await session.createDm(bobPub);
    await settle();

    await session.send(conversation.id, { kind: 'text', text: 'note to self' });
    await session.pollOnce();

    const messages = await session.getMessages(conversation.id);
    expect(messages.map(textOf)).toContain('note to self');
    expect(messages.every((m) => m.fromMe)).toBe(true);
  });

  it('receives a message someone else posted to the topic', async () => {
    const { session, node } = await connect();
    // Creates the conversation and subscribes to its topic.
    await session.createDm(bobPub);
    await settle();

    const received: ChatMessage[] = [];
    await session.streamMessages((m) => received.push(m));

    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload: encodeEnvelope(sealEnvelope('hello alice', BOB, alicePub)),
    });
    await session.pollOnce();

    expect(received.map(textOf)).toEqual(['hello alice']);
    expect(received[0].senderId).toBe(bobPub);
    expect(received[0].fromMe).toBe(false);
  });

  it('rejects a signed envelope from outside the conversation participant set', async () => {
    const { session, node } = await connect();
    const conversation = await session.createDm(bobPub);
    await settle();

    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload: encodeEnvelope(sealEnvelope('topic injection', CAROL, alicePub)),
    });
    await session.pollOnce();

    expect(await session.getMessages(conversation.id)).toHaveLength(0);
  });

  it('round-trips between independently keyed sessions through the node', async () => {
    const node = new FakeWakuNode();
    const { session: aliceSession } = await connect(node, ALICE);
    const { session: bobSession } = await connect(node, BOB);
    const aliceConversation = await aliceSession.createDm(bobPub);
    const bobConversation = await bobSession.createDm(alicePub);
    await settle();

    await aliceSession.send(aliceConversation.id, { kind: 'text', text: 'end to end' });
    await bobSession.pollOnce();

    const messages = await bobSession.getMessages(bobConversation.id);
    expect(messages.map(textOf)).toEqual(['end to end']);
    expect(messages[0].senderId).toBe(alicePub);
    expect(messages[0].fromMe).toBe(false);
  });

  it('ignores an envelope sealed to someone else on the same public topic', async () => {
    const { session, node } = await connect();
    const conversation = await session.createDm(bobPub);
    await settle();

    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload: encodeEnvelope(sealEnvelope('not for alice', BOB, carolPub)),
    });
    node.deliver({ contentTopic: contentTopicFor([alicePub, bobPub]), payload: 'garbage' });
    await session.pollOnce();

    expect(await session.getMessages(conversation.id)).toHaveLength(0);
  });

  it('backfills from the node store when a conversation is opened', async () => {
    const node = new FakeWakuNode();
    // Something already on the node before this device knew about it.
    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload: encodeEnvelope(sealEnvelope('said earlier', BOB, alicePub)),
    });

    const { session } = await connect(node);
    const conversation = await session.createDm(bobPub);
    await settle();

    expect((await session.getMessages(conversation.id)).map(textOf)).toEqual(['said earlier']);
  });

  it('continues through more than twenty realistic store pages', async () => {
    const node = new FakeWakuNode();
    node.storePageSize = 2;
    const topic = contentTopicFor([alicePub, bobPub]);
    for (let i = 0; i < 45; i++) {
      node.deliver({
        contentTopic: topic,
        payload: encodeEnvelope(sealEnvelope(`message ${i}`, BOB, alicePub)),
      });
    }

    const { session } = await connect(node);
    const conversation = await session.createDm(bobPub);
    await settle();

    expect(await session.getMessages(conversation.id)).toHaveLength(45);
    expect(node.historyQueries.length).toBeGreaterThan(20);
  });

  it('continues after a page whose messages are filtered out', async () => {
    const node = new FakeWakuNode();
    node.storePageSize = 1;
    const topic = contentTopicFor([alicePub, bobPub]);
    node.deliver({ contentTopic: topic, payload: '' });
    node.deliver({
      contentTopic: topic,
      payload: encodeEnvelope(sealEnvelope('after empty page', BOB, alicePub)),
    });

    const { session } = await connect(node);
    const conversation = await session.createDm(bobPub);
    await settle();

    expect((await session.getMessages(conversation.id)).map(textOf)).toEqual(['after empty page']);
    expect(node.historyQueries).toHaveLength(2);
  });

  it('retries a consumed poll batch until it is persisted without Store support', async () => {
    class FlakyStore extends InMemoryMessageStore {
      attempts = 0;
      override async insertMessage(...args: Parameters<InMemoryMessageStore['insertMessage']>) {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error('disk full');
        return super.insertMessage(...args);
      }
    }
    const node = new FakeWakuNode();
    node.hasStore = false;
    const store = new FlakyStore();
    const { session } = await connect(node, ALICE, store);
    const conversation = await session.createDm(bobPub);
    await settle();
    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload: encodeEnvelope(sealEnvelope('do not lose me', BOB, alicePub)),
    });

    await expect(session.pollOnce()).rejects.toThrow('disk full');
    await expect(session.pollOnce()).resolves.toBeUndefined();
    expect((await session.getMessages(conversation.id)).map(textOf)).toEqual(['do not lose me']);
  });

  it('does not let a persisted future timestamp move the store cursor', async () => {
    const now = Date.now();
    const topic = contentTopicFor([alicePub, bobPub]);
    const conversationId = conversationIdForTopic(topic);
    const store = new InMemoryMessageStore();
    await store.upsertConversation({
      id: conversationId,
      protocolId: 'waku',
      participants: [alicePub, bobPub].sort(),
      createdAt: now,
      hidden: false,
      routingKey: topic,
    });
    await store.insertMessage({
      id: 'poison',
      conversationId,
      senderId: bobPub,
      sentAt: now + 365 * 24 * 60 * 60 * 1_000,
      fromMe: false,
      status: 'sent',
      content: { kind: 'text', text: 'future' },
    });
    const node = new FakeWakuNode();
    node.deliver({
      contentTopic: topic,
      payload: encodeEnvelope(sealEnvelope('earlier', BOB, alicePub)),
      timestamp: (now - 24 * 60 * 60 * 1_000) * 1_000_000,
    });

    const { session } = await connect(node, ALICE, store);
    await settle();

    expect((await session.getMessages(conversationId)).map(textOf)).toContain('earlier');
    expect(node.historyQueries[0].searchParams.has('startTime')).toBe(false);
  });

  it('advances catch-up from the outer Waku timestamp, not the envelope clock', async () => {
    const now = Date.now();
    const outerTimestamp = now - 60_000;
    const node = new FakeWakuNode();
    const store = new InMemoryMessageStore();
    const { session } = await connect(node, ALICE, store);
    const conversation = await session.createDm(bobPub);
    await settle();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 365 * 24 * 60 * 60 * 1_000);
    const payload = encodeEnvelope(sealEnvelope('future sender clock', BOB, alicePub));
    clock.mockRestore();
    node.deliver({
      contentTopic: contentTopicFor([alicePub, bobPub]),
      payload,
      timestamp: outerTimestamp * 1_000_000,
    });
    await session.pollOnce();

    expect((await session.getMessages(conversation.id))[0].sentAt).toBeGreaterThan(now);
    await expect(store.newestTransportTimestamp('waku', now, conversation.id)).resolves.toBe(
      outerTimestamp
    );
    await session.disconnect();

    await connect(node, ALICE, store);
    await settle();
    expect(node.historyQueries.at(-1)?.searchParams.get('startTime')).toBe(
      String((outerTimestamp - 1_000) * 1_000_000)
    );
  });

  it('still works against a node with no store protocol', async () => {
    const node = new FakeWakuNode();
    node.hasStore = false;

    const { session } = await connect(node);
    const conversation = await session.createDm(bobPub);
    await settle();

    // Starts empty rather than failing to connect.
    expect(await session.getMessages(conversation.id)).toHaveLength(0);
    await session.send(conversation.id, { kind: 'text', text: 'from now on' });
    await session.pollOnce();
    expect((await session.getMessages(conversation.id)).map(textOf)).toContain('from now on');
  });

  it('refuses content it cannot carry', async () => {
    const { session } = await connect();
    const conversation = await session.createDm(bobPub);
    await expect(
      session.send(conversation.id, { kind: 'custom', typeId: 'eth.tx', data: {} })
    ).rejects.toThrow(/can only send text/);
  });

  it('rejects reply metadata instead of silently sending a plain message', async () => {
    const { session, node } = await connect();
    const conversation = await session.createDm(bobPub);
    await settle();

    await expect(
      session.send(conversation.id, { kind: 'text', text: 'reply' }, 'earlier-id')
    ).rejects.toThrow(/does not support reply metadata/);
    expect(node.published).toHaveLength(0);
  });

  it('retries only recipients not known to have accepted a partial group publication', async () => {
    const node = new FakeWakuNode();
    node.failPublishAttempts.add(2);
    const { session } = await connect(node);
    const conversation = await session.createDm(bobPub);
    await settle();

    await expect(
      session.send(conversation.id, { kind: 'text', text: 'once each' })
    ).rejects.toThrow();
    expect(node.published).toHaveLength(1);
    const firstPayload = node.published[0].payload;

    await expect(
      session.send(conversation.id, { kind: 'text', text: 'once each' })
    ).resolves.toBeTruthy();
    expect(node.published).toHaveLength(2);
    expect(node.published.filter((message) => message.payload === firstPayload)).toHaveLength(1);
  });

  it('records the node error so the settings screen can show it', async () => {
    const { session, node } = await connect();
    await session.createDm(bobPub);
    await settle();

    node.down = true;
    await expect(session.pollOnce()).rejects.toThrow();
    expect(session.lastError).toBeTruthy();
  });
});

describe('groups, honestly', () => {
  it('reports the addressed set with no roles', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bobPub, carolPub], 'Trip');

    const members = await session.getMembers(group.id);
    expect(members.map((m) => m.id).sort()).toEqual([alicePub, bobPub, carolPub].sort());
    expect(members.every((m) => m.role === 'member')).toBe(true);
  });

  it('refuses to add or remove, because a topic enforces nothing', async () => {
    const { session } = await connect();
    const group = await session.createGroup([bobPub], 'Duo');

    await expect(session.addMembers(group.id, [carolPub])).rejects.toThrow(/different topic/);
    await expect(session.removeMembers(group.id, [bobPub])).rejects.toThrow(
      /nothing revokes access/
    );
  });

  it('unsubscribes on leave, and drops it from the list', async () => {
    const { session, node } = await connect();
    const group = await session.createGroup([bobPub], 'Duo');
    await settle();
    expect(node.subscriptions.size).toBe(1);

    await session.leaveGroup(group.id);
    expect(node.subscriptions.size).toBe(0);
    expect(await session.listConversations()).toHaveLength(0);
  });
});

describe('identity', () => {
  it('derives from an app-local branch, distinct from the Ethereum key', async () => {
    const { session } = await connect();
    expect(session.self.participantId).toBe(alicePub);
    expect(WAKU_DERIVATION_PATH).not.toBe("m/44'/60'/0'/0/0");
  });

  it('accepts npub or hex peers, like Nostr, since the key format is the same', async () => {
    const { session } = await connect();
    expect(await session.resolvePeer(bobPub)).toBe(bobPub);
    expect(await session.resolvePeer('0x1111111111111111111111111111111111111111')).toBeNull();
  });
});

describe('capabilities', () => {
  it('does not claim forward secrecy for static recipient-key encryption', () => {
    expect(WAKU_PROTOCOL.meta.properties.forwardSecrecy).toBe(false);
  });
});

function textOf(message: ChatMessage): string {
  return message.content.kind === 'text' ? message.content.text : '';
}
