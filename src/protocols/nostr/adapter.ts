import type { DerivedKey } from '@/core/identity/keyring';
import { PartialHistoryError } from '@/core/messaging/history';
import type { MessageStore, StoredConversation } from '@/core/messaging/message-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { StoreBackedSession } from '@/core/messaging/store-backed-session';
import type { ChatTransport, SendResult, TransportSink } from '@/core/messaging/transport';
import type { MessageContent, ParticipantId, SelfIdentity } from '@/core/messaging/types';
import { npubFor, parsePublicKey } from '@/lib/bech32';
import { firstTagValue, nowSeconds, signEvent, type NostrEvent, type Rumor } from './events';
import { identityFromDerivedKey, NOSTR_DERIVATION_PATH, type NostrIdentity } from './keys';
import {
  conversationIdFor,
  KIND_GIFT_WRAP,
  participantsOf,
  unwrapGiftWrap,
  wrapForRecipients,
} from './nip17';
import { RelayPool, type RelayState, type WebSocketLike } from './relay-pool';

export const NOSTR_PROTOCOL_ID = 'nostr';

/**
 * How far back a first sync asks relays to go: applies only when there is no
 * stored cursor, otherwise the filter resumes from the last seen rumor.
 */
const HISTORY_WINDOW_SECONDS = 30 * 24 * 60 * 60;

/**
 * NIP-59 jitters a gift wrap's `created_at` backwards by up to two days to
 * blur when it was sent, so a filter starting exactly at the last seen rumor
 * misses wraps that were already in flight. Re-asking for a few days of
 * overlap is cheap; they dedupe on arrival.
 */
const JITTER_SLACK_SECONDS = 3 * 24 * 60 * 60;

export interface NostrConnectOptions {
  derive(path: string): DerivedKey;
  relays: string[];
  createSocket?(url: string): WebSocketLike;
  store: MessageStore;
}

class NostrTransport implements ChatTransport {
  readonly protocolId = NOSTR_PROTOCOL_ID;
  readonly self: SelfIdentity;

  readonly rosterIsFixed = {
    onAdd:
      'Nostr groups have no roster to add to: the group is whoever a message is addressed to. ' +
      'Start a new group with everyone in it.',
    onRemove:
      'Nostr cannot remove anyone: nothing revokes access to messages already sent, ' +
      'and there is no roster to change.',
  };

  private sink: TransportSink | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly eosed = new Set<string>();
  private readonly historyWaiters = new Set<() => void>();
  private stopped = false;
  private retryHistory = false;
  private historyCursor: number | undefined;
  private deliveryError: unknown;
  private readonly deliveries = new Set<Promise<void>>();
  private readonly pendingSends = new Map<
    string,
    {
      content: string;
      rumor: Rumor;
      remaining: NostrEvent[];
    }
  >();

  constructor(
    readonly identity: NostrIdentity,
    readonly pool: RelayPool
  ) {
    this.self = { participantId: identity.publicKey, address: identity.npub };
  }

  attach(sink: TransportSink): void {
    this.sink = sink;
  }

  /**
   * One subscription for every conversation.
   *
   * Nostr has no per-conversation channel to join: a gift wrap is addressed to
   * a pubkey, so the inbox filter is the whole of it. That is why
   * `openConversation` is not implemented here.
   */
  listen(newestSeenAt?: number): void {
    this.historyCursor = newestSeenAt;
    this.eosed.clear();
    this.unsubscribe?.();
    this.unsubscribe = this.pool.subscribe({
      id: `inbox-${this.identity.publicKey.slice(0, 8)}`,
      filters: [
        {
          kinds: [KIND_GIFT_WRAP],
          '#p': [this.identity.publicKey],
          since: sinceFor(newestSeenAt),
        },
      ],
      onEvent: (event) => this.trackDelivery(event),
      onEose: (url) => {
        this.eosed.add(url);
        for (const check of this.historyWaiters) check();
      },
    });
  }

  private async ingest(event: NostrEvent): Promise<void> {
    const rumor = unwrapGiftWrap(event, this.identity);
    if (!rumor) return;

    try {
      await this.sink?.deliverToParticipants(
        participantsOf(rumor),
        {
          ...this.toIncoming(rumor),
          transportTimestamp: event.created_at * 1000,
        },
        {
          title: firstTagValue(rumor, 'subject'),
          createdAt: rumor.created_at * 1000,
        }
      );
    } catch (error) {
      this.deliveryError = error;
      this.retryHistory = true;
      throw error;
    }
  }

  private trackDelivery(event: NostrEvent): Promise<void> {
    const delivery = this.ingest(event);
    this.deliveries.add(delivery);
    void delivery.finally(() => this.deliveries.delete(delivery)).catch(() => {});
    return delivery;
  }

  private toIncoming(rumor: Rumor) {
    return {
      id: rumor.id,
      senderId: rumor.pubkey,
      sentAt: rumor.created_at * 1000,
      content: { kind: 'text', text: rumor.content } as MessageContent,
      fromMe: rumor.pubkey === this.identity.publicKey,
    };
  }

  conversationIdFor(participants: ParticipantId[]): string {
    return conversationIdFor(participants);
  }

  async send(conversation: StoredConversation, content: MessageContent): Promise<SendResult> {
    if (content.kind !== 'text') {
      throw new Error(`Nostr can only send text, not "${content.kind}"`);
    }

    const recipients = conversation.participants.filter((p) => p !== this.identity.publicKey);

    let pending = this.pendingSends.get(conversation.id);
    if (pending && pending.content !== content.text) {
      throw new Error(
        'Finish retrying the partially published Nostr message before sending another'
      );
    }
    if (!pending) {
      const wrapped = wrapForRecipients(this.identity, {
        recipients,
        content: content.text,
        subject: conversation.title,
      });
      pending = { content: content.text, rumor: wrapped.rumor, remaining: wrapped.wraps };
      this.pendingSends.set(conversation.id, pending);
    }

    while (pending.remaining.length > 0) {
      await this.pool.publish(pending.remaining[0]);
      pending.remaining.shift();
    }
    // Handed back rather than read off the network: a gift wrap is sealed to
    // its recipient, so we cannot open our own copy.
    return { id: pending.rumor.id, localMessage: this.toIncoming(pending.rumor) };
  }

  confirmSend(conversationId: string, messageId: string): void {
    if (this.pendingSends.get(conversationId)?.rumor.id === messageId) {
      this.pendingSends.delete(conversationId);
    }
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
    if (this.stopped) throw new Error('Nostr disconnected');
    if (this.retryHistory) {
      this.retryHistory = false;
      this.deliveryError = undefined;
      this.listen(this.historyCursor);
    }
    const urls = this.pool.states.map((relay) => relay.url);
    if (urls.length === 0) throw new Error('No Nostr relays configured');
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.historyWaiters.delete(check);
        if (error) {
          this.retryHistory = true;
          reject(error);
        } else resolve();
      };
      const check = () => {
        if (this.stopped) finish(new Error('Nostr disconnected'));
        else if (urls.every((url) => this.eosed.has(url))) finish();
      };
      const timer = setTimeout(() => {
        const completed = urls.filter((url) => this.eosed.has(url));
        const unavailable = urls.filter((url) => !this.eosed.has(url));
        finish(
          completed.length > 0
            ? new PartialHistoryError(
                `History fetched from ${completed.length} of ${urls.length} relays. Unavailable: ${unavailable.join(', ')}`
              )
            : new Error('Nostr history fetch timed out')
        );
      }, 15_000);
      this.historyWaiters.add(check);
      check();
    });
    await Promise.allSettled([...this.deliveries]);
    if (this.deliveryError) {
      const error = this.deliveryError;
      this.deliveryError = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    for (const check of this.historyWaiters) check();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pool.close();
  }
}

export class NostrSession extends StoreBackedSession implements ChatSession {
  private constructor(
    private readonly nostr: NostrTransport,
    store: MessageStore
  ) {
    super(nostr, store);
    nostr.attach(this);
  }

  static async connect(options: NostrConnectOptions): Promise<NostrSession> {
    const identity = identityFromDerivedKey(options.derive(NOSTR_DERIVATION_PATH));
    const transport = new NostrTransport(
      identity,
      new RelayPool({
        urls: options.relays,
        createSocket: options.createSocket,
        authenticate: (url, challenge) =>
          signEvent(
            {
              pubkey: identity.publicKey,
              created_at: nowSeconds(),
              kind: 22242,
              tags: [
                ['relay', url],
                ['challenge', challenge],
              ],
              content: '',
            },
            identity.secretKey
          ),
      })
    );

    const session = new NostrSession(transport, options.store);
    await session.hydrate();
    transport.listen(await session.newestSeenAt(Date.now()));
    return session;
  }

  get relays(): RelayState[] {
    return this.nostr.pool.states;
  }

  get npub(): string {
    return this.nostr.identity.npub;
  }
}

/**
 * Where the inbox filter starts.
 *
 * The last rumor we stored, less the jitter slack; on a device with no
 * history at all, the opening window.
 */
function sinceFor(newestSeenAt?: number): number {
  if (newestSeenAt === undefined) {
    return nowSeconds() - HISTORY_WINDOW_SECONDS - JITTER_SLACK_SECONDS;
  }
  return Math.floor(newestSeenAt / 1000) - JITTER_SLACK_SECONDS;
}
