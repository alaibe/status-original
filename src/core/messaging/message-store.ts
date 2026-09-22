import type { ChatMessage, ConversationId, MessageId, ParticipantId } from './types';

export interface StoredConversation {
  id: ConversationId;
  protocolId: string;
  participants: ParticipantId[];
  title?: string;
  createdAt: number;
  hidden: boolean;
  routingKey?: string;
}

export interface MessageStore {
  loadConversations(protocolId: string): Promise<StoredConversation[]>;
  loadMessages(
    conversationId: ConversationId,
    limit?: number,
    before?: { sentAt: number; id: MessageId }
  ): Promise<ChatMessage[]>;

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

  async clear(protocolId: string): Promise<void> {
    for (const [id, conversation] of [...this.conversations]) {
      if (conversation.protocolId !== protocolId) continue;
      this.conversations.delete(id);
      this.messages.delete(id);
      this.transportTimestamps.delete(id);
    }
  }
}
