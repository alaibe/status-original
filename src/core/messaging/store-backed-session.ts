import { HistoryTracker, type HistoryState } from './history';
import type { MessageStore, StoredConversation } from './message-store';
import type { ChatSession } from './protocol';
import type { ChatTransport, IncomingMessage, TransportSink } from './transport';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  GroupMember,
  MessageContent,
  MessageId,
  ParticipantId,
  SelfIdentity,
  Unsubscribe,
} from './types';

export class StoreBackedSession implements ChatSession, TransportSink {
  readonly self: SelfIdentity;

  private readonly conversations = new Map<ConversationId, StoredConversation>();
  private readonly byRoutingKey = new Map<string, StoredConversation>();
  private readonly messageListeners = new Set<(message: ChatMessage) => void>();
  private readonly conversationListeners = new Set<(conversation: Conversation) => void>();
  private readonly history = new HistoryTracker();
  private readonly opening = new Map<ConversationId, Promise<void>>();
  private deliveries = Promise.resolve();
  private failedDelivery: string | undefined;
  private acceptingDeliveries = true;

  constructor(
    private readonly transport: ChatTransport,
    private readonly store: MessageStore
  ) {
    this.self = transport.self;
  }

  async hydrate(): Promise<void> {
    const stored = await this.store.loadConversations(this.transport.protocolId);
    for (const conversation of stored) this.remember(conversation);
    for (const conversation of this.conversations.values()) {
      if (!conversation.hidden) void this.open(conversation)?.catch(() => {});
    }
  }

  deliverToRoutingKey(routingKey: string, incoming: IncomingMessage): Promise<void> {
    if (!this.acceptingDeliveries) return Promise.resolve();
    return this.enqueueDelivery(async () => {
      const conversation = this.byRoutingKey.get(routingKey);
      if (conversation) await this.deliver(conversation, incoming, false);
    });
  }

  deliverToParticipants(
    participants: ParticipantId[],
    incoming: IncomingMessage,
    meta?: { title?: string; createdAt?: number }
  ): Promise<void> {
    if (!this.acceptingDeliveries) return Promise.resolve();
    return this.enqueueDelivery(async () => {
      const id = this.transport.conversationIdFor(participants);
      const existing = this.conversations.get(id);
      const conversation = existing
        ? {
            ...existing,
            title: meta?.title ?? existing.title,
            createdAt:
              meta?.createdAt === undefined
                ? existing.createdAt
                : Math.min(existing.createdAt, meta.createdAt),
            hidden: false,
          }
        : this.build(participants, meta?.title, meta?.createdAt);
      await this.deliver(conversation, incoming, !existing || existing.hidden);
    });
  }

  private async deliver(
    conversation: StoredConversation,
    incoming: IncomingMessage,
    isNew: boolean
  ) {
    const visible = { ...conversation, hidden: false };
    const message: ChatMessage = { ...incoming, conversationId: visible.id, status: 'sent' };

    let inserted: boolean;
    const deliveryKey = `${visible.id}:${message.id}`;
    try {
      inserted = await this.store.insertMessage(
        message,
        this.snapshot(visible),
        incoming.transportTimestamp
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown storage error';
      const failure = new Error(`Could not save message history: ${detail}`);
      this.failedDelivery = deliveryKey;
      this.history.reportFailure(failure);
      throw failure;
    }

    if (this.failedDelivery === deliveryKey) {
      this.failedDelivery = undefined;
      this.history.clearFailure();
    }
    this.remember(visible);
    if (isNew) this.announce(visible, message);
    if (inserted) for (const listener of this.messageListeners) listener(message);
  }

  private enqueueDelivery(work: () => Promise<void>): Promise<void> {
    const result = this.deliveries.then(work, work);
    this.deliveries = result.catch(() => {});
    return result;
  }
  private build(
    participants: ParticipantId[],
    title?: string,
    createdAt?: number
  ): StoredConversation {
    const sorted = [...new Set([...participants, this.self.participantId])].sort();
    return {
      id: this.transport.conversationIdFor(sorted),
      protocolId: this.transport.protocolId,
      participants: sorted,
      title,
      createdAt: createdAt ?? Date.now(),
      hidden: false,
      routingKey: this.transport.routingKeyFor?.(sorted),
    };
  }
  private remember(conversation: StoredConversation): void {
    this.conversations.set(conversation.id, conversation);
    if (conversation.routingKey) this.byRoutingKey.set(conversation.routingKey, conversation);
  }
  private open(conversation: StoredConversation): Promise<void> | undefined {
    if (!this.transport.openConversation) return;
    const existing = this.opening.get(conversation.id);
    if (existing) return existing;
    const work = this.history
      .run(async () => {
        const since = await this.store.newestTransportTimestamp(
          this.transport.protocolId,
          this.transport.cursorUpperBound?.() ?? Number.POSITIVE_INFINITY,
          conversation.id
        );
        await this.transport.openConversation!(this.snapshot(conversation), { since });
      })
      .finally(() => this.opening.delete(conversation.id));
    this.opening.set(conversation.id, work);
    return work;
  }

  newestSeenAt(notAfter = Number.POSITIVE_INFINITY): Promise<number | undefined> {
    return this.store.newestTransportTimestamp(this.transport.protocolId, notAfter);
  }
  private announce(conversation: StoredConversation, lastMessage?: ChatMessage): void {
    const projected = this.toConversation(conversation, lastMessage);
    for (const listener of this.conversationListeners) listener(projected);
  }
  private toConversation(
    conversation: StoredConversation,
    lastMessage?: ChatMessage
  ): Conversation {
    const others = conversation.participants.filter((id) => id !== this.self.participantId);
    return {
      id: conversation.id,
      kind: others.length > 1 ? 'group' : 'dm',
      title: conversation.title?.trim() || (others[0] ?? this.self.participantId),
      memberIds: conversation.participants,
      createdAt: conversation.createdAt,
      consent: 'allowed',
      lastMessage,
      selfRole: undefined,
    };
  }
  private require(id: ConversationId): StoredConversation {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error(`Conversation ${id} not found`);
    return conversation;
  }
  private async ensure(peers: ParticipantId[], title?: string): Promise<StoredConversation> {
    const participants = [...new Set([...peers, this.self.participantId])].sort();
    const id = this.transport.conversationIdFor(participants);
    const existing = this.conversations.get(id);
    const conversation = existing
      ? { ...existing, hidden: false, title: title ?? existing.title }
      : this.build(participants, title);

    if (!existing || existing.hidden || title) await this.store.upsertConversation(conversation);
    this.remember(conversation);
    if (!existing) void this.open(conversation)?.catch(() => {});
    return conversation;
  }

  async listConversations(): Promise<Conversation[]> {
    const [stored, latest] = await Promise.all([
      this.store.loadConversations(this.transport.protocolId),
      this.store.latestMessages(this.transport.protocolId),
    ]);
    return stored
      .filter((conversation) => !conversation.hidden)
      .map((conversation) => this.toConversation(conversation, latest.get(conversation.id)));
  }

  async getMessages(
    id: ConversationId,
    opts?: {
      limit?: number;
      before?: { sentAt: number; id: MessageId };
    }
  ): Promise<ChatMessage[]> {
    if (!this.conversations.has(id)) return [];
    return this.store.loadMessages(id, opts?.limit, opts?.before);
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    return this.transport.resolvePeer(addressOrId);
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    return this.transport.resolveAddresses(ids);
  }

  async createDm(peer: ParticipantId): Promise<Conversation> {
    return this.toConversation(await this.ensure([peer]));
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    return this.toConversation(await this.ensure(peers, title));
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    return this.require(id).participants.map((participant) => ({
      id: participant,
      role: 'member',
    }));
  }

  async addMembers(_id: ConversationId, _peers: ParticipantId[]): Promise<void> {
    throw new Error(this.transport.rosterIsFixed.onAdd);
  }

  async removeMembers(_id: ConversationId, _peers: ParticipantId[]): Promise<void> {
    throw new Error(this.transport.rosterIsFixed.onRemove);
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    const conversation = { ...this.require(id), title };
    await this.store.upsertConversation(conversation);
    this.remember(conversation);
    this.announce(conversation, (await this.store.loadMessages(id, 1))[0]);
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    const conversation = { ...this.require(id), hidden: true };
    await this.store.upsertConversation(conversation);
    this.remember(conversation);
    if (conversation.routingKey) this.byRoutingKey.delete(conversation.routingKey);
    await this.transport.closeConversation?.(this.snapshot(conversation));
  }

  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    if (replyTo) throw new Error(`${this.transport.protocolId} does not support reply metadata`);
    const conversation = this.require(id);
    const result = await this.transport.send(this.snapshot(conversation), content);
    if (result.localMessage) {
      await this.enqueueDelivery(() => this.deliver(conversation, result.localMessage!, false));
    }
    this.transport.confirmSend?.(id, result.id);
    return result.id;
  }

  async sync(): Promise<void> {
    await this.deliveries;
    await this.history.run(async () => {
      const results = await Promise.allSettled(
        [...this.conversations.values()]
          .filter((conversation) => !conversation.hidden)
          .map((conversation) => this.open(conversation))
      );
      await this.transport.sync();
      await this.deliveries;
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
  }

  subscribeHistory(listener: (state: HistoryState) => void): Unsubscribe {
    return this.history.subscribe(listener);
  }

  async streamMessages(onMessage: (message: ChatMessage) => void): Promise<Unsubscribe> {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  async streamConversations(
    onConversation: (conversation: Conversation) => void
  ): Promise<Unsubscribe> {
    this.conversationListeners.add(onConversation);
    return () => this.conversationListeners.delete(onConversation);
  }

  async disconnect(): Promise<void> {
    this.acceptingDeliveries = false;
    try {
      await this.transport.disconnect();
    } finally {
      await this.deliveries;
      this.messageListeners.clear();
      this.conversationListeners.clear();
    }
  }

  private snapshot(conversation: StoredConversation): StoredConversation {
    return { ...conversation, participants: [...conversation.participants] };
  }
}
