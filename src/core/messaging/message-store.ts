import type { ChatMessage, Conversation, ConversationId, MessageId, ParticipantId } from './types';
import { matchesSearch, SEARCH_LIMIT } from './search';
import { countsAsUnread } from './unread';

export interface StoredConversation {
  id: ConversationId;
  protocolId: string;
  participants: ParticipantId[];
  title?: string;
  createdAt: number;
  hidden: boolean;
  routingKey?: string;
}

export interface StoredSearchHit {
  message: ChatMessage;
  protocolId?: string;
}

export interface MessageStore {
  loadConversations(protocolId: string): Promise<StoredConversation[]>;
  loadMessages(
    conversationId: ConversationId,
    limit?: number,
    before?: { sentAt: number; id: MessageId }
  ): Promise<ChatMessage[]>;
  searchMessages(
    query: string,
    conversationId?: ConversationId,
    protocolId?: string
  ): Promise<StoredSearchHit[]>;
  countUnreadMessages(conversationId: ConversationId, since: number): Promise<number>;

  upsertConversation(conversation: StoredConversation): Promise<void>;
  insertMessage(
    message: ChatMessage,
    conversation?: StoredConversation,
    transportTimestamp?: number
  ): Promise<boolean>;
  latestMessages(protocolId: string): Promise<Map<ConversationId, ChatMessage>>;
  newestTransportTimestamp(
    protocolId: string,
    notAfter: number,
    conversationId?: ConversationId
  ): Promise<number | undefined>;
  clear(protocolId: string): Promise<void>;
  cachedConversations(): Promise<Conversation[]>;
  cacheConversations(keep: Conversation[], drop: ConversationId[]): Promise<void>;
}

export const HYDRATE_LIMIT = 500;

export class InMemoryMessageStore implements MessageStore {
  private readonly conversations = new Map<ConversationId, StoredConversation>();
  private readonly messages = new Map<ConversationId, Map<string, ChatMessage>>();

  async loadConversations(protocolId: string): Promise<StoredConversation[]> {
    return [...this.conversations.values()]
      .filter((c) => c.protocolId === protocolId)
      .map((c) => ({ ...c, participants: [...c.participants] }));
  }

  async loadMessages(
    conversationId: ConversationId,
    limit = HYDRATE_LIMIT,
    before?: { sentAt: number; id: MessageId }
  ) {
    const byId = this.messages.get(conversationId);
    if (!byId) return [];
    const sorted = [...byId.values()]
      .filter(
        (message) =>
          !before ||
          message.sentAt < before.sentAt ||
          (message.sentAt === before.sentAt && message.id < before.id)
      )
      .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
    return sorted.slice(-limit);
  }

  async searchMessages(
    query: string,
    conversationId?: ConversationId,
    protocolId?: string
  ): Promise<StoredSearchHit[]> {
    const needle = query.toLowerCase();
    return [...this.messages.entries()]
      .filter(
        ([id]) =>
          (!conversationId || id === conversationId) &&
          (!protocolId || this.conversations.get(id)?.protocolId === protocolId)
      )
      .flatMap(([id, messages]) =>
        [...messages.values()].map((message) => ({
          message,
          protocolId: this.conversations.get(id)?.protocolId,
        }))
      )
      .filter(({ message }) => matchesSearch(message, needle))
      .sort((a, b) => b.message.sentAt - a.message.sentAt)
      .slice(0, SEARCH_LIMIT);
  }

  async countUnreadMessages(conversationId: ConversationId, since: number): Promise<number> {
    return [...(this.messages.get(conversationId)?.values() ?? [])].filter((message) =>
      countsAsUnread(message, since)
    ).length;
  }

  async upsertConversation(conversation: StoredConversation): Promise<void> {
    this.conversations.set(conversation.id, {
      ...conversation,
      participants: [...conversation.participants],
    });
  }

  async insertMessage(
    message: ChatMessage,
    conversation?: StoredConversation,
    transportTimestamp?: number
  ): Promise<boolean> {
    let byId = this.messages.get(message.conversationId);
    if (!byId) {
      byId = new Map();
      this.messages.set(message.conversationId, byId);
    }
    const inserted = !byId.has(message.id);
    if (conversation) await this.upsertConversation(conversation);
    if (inserted) byId.set(message.id, message);
    if (transportTimestamp !== undefined) {
      const current = this.transportTimestamps.get(message.conversationId);
      if (current === undefined || transportTimestamp > current) {
        this.transportTimestamps.set(message.conversationId, transportTimestamp);
      }
    }
    return inserted;
  }

  private readonly transportTimestamps = new Map<string, number>();

  async newestTransportTimestamp(
    protocolId: string,
    notAfter: number,
    conversationId?: ConversationId
  ): Promise<number | undefined> {
    let newest: number | undefined;
    for (const conversation of this.conversations.values()) {
      if (
        conversation.protocolId !== protocolId ||
        (conversationId && conversation.id !== conversationId)
      )
        continue;
      const timestamp = this.transportTimestamps.get(conversation.id);
      if (
        timestamp !== undefined &&
        timestamp <= notAfter &&
        (newest === undefined || timestamp > newest)
      ) {
        newest = timestamp;
      }
    }
    return newest;
  }

  async latestMessages(protocolId: string): Promise<Map<ConversationId, ChatMessage>> {
    const latest = new Map<ConversationId, ChatMessage>();
    for (const conversation of this.conversations.values()) {
      if (conversation.protocolId !== protocolId) continue;
      const [newest] = await this.loadMessages(conversation.id, 1);
      if (newest) latest.set(conversation.id, newest);
    }
    return latest;
  }

  private readonly cached = new Map<ConversationId, Conversation>();

  async cachedConversations(): Promise<Conversation[]> {
    return [...this.cached.values()];
  }

  async cacheConversations(keep: Conversation[], drop: ConversationId[]): Promise<void> {
    for (const conversation of keep) this.cached.set(conversation.id, conversation);
    for (const id of drop) this.cached.delete(id);
  }

  async clear(protocolId: string): Promise<void> {
    for (const [id, conversation] of [...this.conversations]) {
      if (conversation.protocolId !== protocolId) continue;
      this.conversations.delete(id);
      this.messages.delete(id);
      this.transportTimestamps.delete(id);
    }
  }
}
