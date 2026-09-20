import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

import type { DerivedKey } from '@/core/identity/keyring';
import { PartialHistoryError } from '@/core/messaging/history';
import type { MessageStore, StoredConversation } from '@/core/messaging/message-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { StoreBackedSession } from '@/core/messaging/store-backed-session';
import type { ChatTransport, SendResult, TransportSink } from '@/core/messaging/transport';
import type { MessageContent, ParticipantId, SelfIdentity } from '@/core/messaging/types';
import { encodeNpub, npubFor, parsePublicKey } from '@/lib/bech32';
import {
  contentTopicFor,
  conversationIdForTopic,
  decodeEnvelope,
  encodeEnvelope,
  openEnvelope,
  sealEnvelope,
} from './crypto';
import { WakuRestClient, type WakuRestMessage } from './rest';

export const WAKU_PROTOCOL_ID = 'waku';
export const WAKU_DERIVATION_PATH = "m/44'/60'/1'/0/0";

const POLL_INTERVAL_MS = 4_000;
const RESUBSCRIBE_EVERY = 15;

export interface WakuConnectOptions {
  derive(path: string): DerivedKey;
  nodeUrl: string;
  fetchImpl?: typeof fetch;
  autoPoll?: boolean;
  store: MessageStore;
}

class WakuTransport implements ChatTransport {
  readonly protocolId = WAKU_PROTOCOL_ID;
  readonly self: SelfIdentity;

  readonly rosterIsFixed = {
    onAdd:
      'A Waku conversation is a content topic derived from its participants. ' +
      'Adding someone means a different topic, so start a new group instead.',
    onRemove:
      'Waku cannot remove anyone: a content topic is public and nothing revokes access to it.',
  };

  private sink: TransportSink | null = null;
  private readonly openTopics = new Set<string>();
  private readonly topicParticipants = new Map<string, Set<string>>();
  private readonly pendingSends = new Map<string, {
    content: string;
    messageId: string;
    remaining: { recipient: string; message: WakuRestMessage }[];
  }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingPolls = new Map<string, WakuRestMessage[]>();
  private polling: Promise<void> | null = null;
  private polls = 0;
  private stopped = false;

  lastError: string | null = null;

  constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKey: string,
    private readonly client: WakuRestClient,
  ) {
    this.self = {
      participantId: publicKey,
      address: encodeNpub(schnorr.getPublicKey(secretKey)),
    };
  }

  attach(sink: TransportSink): void {
    this.sink = sink;
  }

  startPolling(): void {
    this.timer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return this.polling;
    const polling = this.runPoll();
    this.polling = polling;
    try {
      await polling;
    } finally {
      if (this.polling === polling) this.polling = null;
    }
  }

  private async runPoll(): Promise<void> {
    if (this.stopped) return;

    const topics = [...this.openTopics];
    if (topics.length === 0) return;

    try {
      if (this.polls % RESUBSCRIBE_EVERY === 0) await this.client.subscribe(topics);
      this.polls += 1;

      for (const topic of topics) {
        let messages = this.pendingPolls.get(topic);
        if (!messages) {
          messages = await this.client.poll(topic);
          if (messages.length > 0) this.pendingPolls.set(topic, messages);
        }
        while (messages.length > 0) {
          await this.ingest(messages[0]);
          messages.shift();
        }
        this.pendingPolls.delete(topic);
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Waku node unreachable';
      throw error;
    }
  }

  /**
   * A content topic is public, so anything can be posted to it. An envelope
   * that will not open was not sealed to us, and is dropped rather than
   * surfaced.
   */
  private async ingest(raw: WakuRestMessage): Promise<void> {
    if (this.stopped || !this.openTopics.has(raw.contentTopic)) return;
    const envelope = decodeEnvelope(raw.payload);
    if (!envelope) return;

    const opened = openEnvelope(envelope, this.secretKey);
    if (!opened) return;
    if (!this.topicParticipants.get(raw.contentTopic)?.has(opened.sender)) return;

    await this.sink?.deliverToRoutingKey(raw.contentTopic, {
      id: messageIdFor(envelope.from, envelope.ts, envelope.sig),
      senderId: opened.sender,
      sentAt: opened.sentAt,
      content: { kind: 'text', text: opened.plaintext },
      fromMe: opened.sender === this.publicKey,
      transportTimestamp: raw.timestamp === undefined
        ? undefined
        : Math.round(raw.timestamp / 1_000_000),
    });
  }

  conversationIdFor(participants: ParticipantId[]): string {
    return conversationIdForTopic(contentTopicFor(participants));
  }

  routingKeyFor(participants: ParticipantId[]): string {
    return contentTopicFor(participants);
  }

  cursorUpperBound(): number {
    return Date.now();
  }

  /**
   * Subscribe, then page the node's store from where the stored history ends.
   * `since` is nudged back by a second because Waku timestamps come from the
   * sender's clock, and an exact boundary drops a message that shares the last
   * one's. Store failures propagate to the history indicator; live messaging
   * stays available and catch-up can be retried on its own.
   */
  async openConversation(
    conversation: StoredConversation,
    opts?: { since?: number },
  ): Promise<void> {
    const topic = conversation.routingKey;
    if (!topic || this.stopped) return;

    this.openTopics.add(topic);
    this.topicParticipants.set(topic, new Set(conversation.participants));
    try {
      await this.client.subscribe([topic]);

      const startTime = opts?.since === undefined ? undefined : opts.since - 1_000;
      let cursor: string | undefined;
      const seenCursors = new Set<string>();

      for (;;) {
        if (this.stopped || !this.openTopics.has(topic)) return;
        const result = await this.client.history([topic], { cursor, startTime });
        if (this.stopped || !this.openTopics.has(topic)) return;
        for (const message of result.messages) await this.ingest(message);

        if (!result.cursor) break;
        if (seenCursors.has(result.cursor)) {
          throw new PartialHistoryError('Waku history pagination stopped making progress; retry catch-up');
        }
        seenCursors.add(result.cursor);
        cursor = result.cursor;
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Waku history unavailable';
      throw error;
    }
  }

  async closeConversation(conversation: StoredConversation): Promise<void> {
    const topic = conversation.routingKey;
    if (!topic) return;

    this.openTopics.delete(topic);
    this.topicParticipants.delete(topic);
    try {
      await this.client.unsubscribe([topic]);
    } catch {}
  }

  async send(conversation: StoredConversation, content: MessageContent): Promise<SendResult> {
    if (content.kind !== 'text') {
      throw new Error(`Waku can only send text, not "${content.kind}"`);
    }

    const topic = conversation.routingKey;
    if (!topic) throw new Error(`Conversation ${conversation.id} has no content topic`);

    let pending = this.pendingSends.get(conversation.id);
    if (pending && pending.content !== content.text) {
      throw new Error('Finish retrying the partially published Waku message before sending another');
    }
    if (!pending) {
      let messageId = '';
      const remaining = [...new Set([...conversation.participants, this.publicKey])].map((recipient) => {
        const envelope = sealEnvelope(content.text, this.secretKey, recipient);
        if (recipient === this.publicKey) {
          messageId = messageIdFor(envelope.from, envelope.ts, envelope.sig);
        }
        return {
          recipient,
          message: {
            payload: encodeEnvelope(envelope),
            contentTopic: topic,
            version: 0,
            timestamp: Date.now() * 1_000_000,
          },
        };
      });
      pending = { content: content.text, messageId, remaining };
      this.pendingSends.set(conversation.id, pending);
    }

    while (pending.remaining.length > 0) {
      await this.client.publish(pending.remaining[0].message);
      pending.remaining.shift();
    }
    this.pendingSends.delete(conversation.id);
    return { id: pending.messageId || `${this.publicKey.slice(0, 16)}-${Date.now()}` };
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    return parsePublicKey(addressOrId);
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const npub = npubFor(id);
      if (npub) out[id] = npub;
    }
    return out;
  }

  async sync(): Promise<void> {
    await this.pollOnce();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.openTopics.clear();
    this.topicParticipants.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class WakuSession extends StoreBackedSession implements ChatSession {
  private constructor(
    private readonly waku: WakuTransport,
    store: MessageStore,
  ) {
    super(waku, store);
    waku.attach(this);
  }

  static async connect(options: WakuConnectOptions): Promise<WakuSession> {
    const derived = options.derive(WAKU_DERIVATION_PATH);
    const secretKey = derived.privateKey.slice(0, 32);

    const client = new WakuRestClient({
      nodeUrl: options.nodeUrl,
      fetchImpl: options.fetchImpl,
    });

    await client.info();

    const transport = new WakuTransport(
      secretKey,
      bytesToHex(schnorr.getPublicKey(secretKey)),
      client,
    );

    const session = new WakuSession(transport, options.store);
    await session.hydrate();
    if (options.autoPoll !== false) transport.startPolling();
    return session;
  }

  /** Surfaced for the settings screen, which shows why a node is unreachable. */
  get lastError(): string | null {
    return this.waku.lastError;
  }

  pollOnce(): Promise<void> {
    return this.waku.pollOnce();
  }
}

/**
 * Stable across devices: the same envelope produces the same id wherever it is
 * opened, which is what makes dedupe work when a message arrives from both the
 * store backfill and a live poll.
 */
function messageIdFor(from: string, ts: number | string, sig: string): string {
  return `${from.slice(0, 16)}-${ts}-${sig.slice(0, 16)}`;
}
