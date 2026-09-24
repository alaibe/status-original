import { isParticipantId } from './bots';
import type { ChatSession } from './protocol';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  GroupMember,
  GroupRole,
  MessageContent,
  MessageId,
  ParticipantId,
  SelfIdentity,
  Unsubscribe,
} from './types';

export class InMemoryChatSession implements ChatSession {
  readonly self: SelfIdentity;
  readonly sendsCustom = true;

  private conversations = new Map<ConversationId, Conversation>();
  private messages = new Map<ConversationId, ChatMessage[]>();
  private addresses = new Map<ParticipantId, string>();
  private roles = new Map<string, GroupRole>();

  private messageListeners = new Set<(m: ChatMessage) => void>();
  private conversationListeners = new Set<(c: Conversation) => void>();

  readonly sent: { conversationId: ConversationId; content: MessageContent }[] = [];
  readonly left: ConversationId[] = [];
  syncCount = 0;
  disconnected = false;
  erased = false;

  constructor(self?: Partial<SelfIdentity>) {
    this.self = {
      participantId: 'a'.repeat(64),
      address: '0x1111111111111111111111111111111111111111',
      ...self,
    };
  }

  seedConversation(partial: Partial<Conversation> & { id: ConversationId }): Conversation {
    const conversation: Conversation = {
      kind: 'dm',
      title: partial.id,
      memberIds: [this.self.participantId, 'b'.repeat(64)],
      createdAt: 1_000,
      consent: 'allowed',
      ...partial,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, this.messages.get(conversation.id) ?? []);
    return conversation;
  }

  seedAddress(participantId: ParticipantId, address: string) {
    this.addresses.set(participantId, address);
  }

  seedRole(conversationId: ConversationId, participantId: ParticipantId, role: GroupRole) {
    this.roles.set(`${conversationId}:${participantId}`, role);
  }

  deliver(conversationId: ConversationId, message: Partial<ChatMessage> = {}): ChatMessage {
    const full: ChatMessage = {
      id: `remote-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      senderId: 'b'.repeat(64),
      sentAt: 2_000,
      content: { kind: 'text', text: 'hello from the network' },
      fromMe: false,
      status: 'sent',
      ...message,
    };

    this.messages.set(conversationId, [...(this.messages.get(conversationId) ?? []), full]);

    const conversation = this.conversations.get(conversationId);
    if (conversation && full.content.kind !== 'reaction') {
      const newer = (conversation.lastMessage?.sentAt ?? 0) <= full.sentAt;
      if (newer) this.conversations.set(conversationId, { ...conversation, lastMessage: full });
    }

    for (const listener of this.messageListeners) listener(full);
    return full;
  }

  announce(conversation: Conversation) {
    this.conversations.set(conversation.id, conversation);
    for (const listener of this.conversationListeners) listener(conversation);
  }

  async listConversations(): Promise<Conversation[]> {
    return [...this.conversations.values()];
  }

  async getMessages(
    id: ConversationId,
    opts?: { limit?: number; before?: { sentAt: number; id: MessageId } }
  ): Promise<ChatMessage[]> {
    const messages = [...(this.messages.get(id) ?? [])]
      .filter(
        (message) =>
          !opts?.before ||
          message.sentAt < opts.before.sentAt ||
          (message.sentAt === opts.before.sentAt && message.id < opts.before.id)
      )
      .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
    return opts?.limit ? messages.slice(-opts.limit) : messages;
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    if (isParticipantId(addressOrId)) return addressOrId;
    for (const [participantId, address] of this.addresses) {
      if (address.toLowerCase() === addressOrId.toLowerCase()) return participantId;
    }
    return null;
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const address = this.addresses.get(id);
      if (address) out[id] = address;
    }
    return out;
  }

  async createDm(peer: ParticipantId): Promise<Conversation> {
    return this.seedConversation({
      id: `dm-${peer.slice(0, 6)}`,
      memberIds: [this.self.participantId, peer],
      title: peer,
    });
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    return this.seedConversation({
      id: `group-${title}`,
      kind: 'group',
      title,
      memberIds: [this.self.participantId, ...peers],
      selfRole: 'owner',
    });
  }

  private requireGroup(id: ConversationId): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error(`Conversation ${id} not found`);
    if (conversation.kind !== 'group') throw new Error('That only works in a group conversation.');
    return conversation;
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    const conversation = this.requireGroup(id);
    return conversation.memberIds.map((memberId) => ({
      id: memberId,
      role:
        this.roles.get(`${id}:${memberId}`) ??
        (memberId === this.self.participantId ? 'owner' : 'member'),
    }));
  }

  async addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    const conversation = this.requireGroup(id);
    const next = {
      ...conversation,
      memberIds: [...new Set([...conversation.memberIds, ...peers])],
    };
    this.conversations.set(id, next);
    for (const listener of this.conversationListeners) listener(next);
  }

  async removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    const conversation = this.requireGroup(id);
    const drop = new Set(peers);
    const next = {
      ...conversation,
      memberIds: conversation.memberIds.filter((m) => !drop.has(m)),
    };
    this.conversations.set(id, next);
    for (const listener of this.conversationListeners) listener(next);
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    const conversation = this.requireGroup(id);
    const next = { ...conversation, title };
    this.conversations.set(id, next);
    for (const listener of this.conversationListeners) listener(next);
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    this.requireGroup(id);
    this.conversations.delete(id);
    this.left.push(id);
  }

  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    const next = { ...conversation, consent };
    this.conversations.set(id, next);
    for (const listener of this.conversationListeners) listener(next);
  }

  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    if (!this.conversations.has(id)) throw new Error(`Conversation ${id} not found`);

    this.sent.push({ conversationId: id, content });
    const messageId = `sent-${this.sent.length}`;
    const outbound: ChatMessage = {
      id: messageId,
      conversationId: id,
      senderId: this.self.participantId,
      sentAt: 3_000,
      content,
      fromMe: true,
      status: 'sent',
      replyTo,
    };

    this.messages.set(id, [...(this.messages.get(id) ?? []), outbound]);
    return messageId;
  }

  async sync(): Promise<void> {
    this.syncCount += 1;
  }

  async streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe> {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  async streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe> {
    this.conversationListeners.add(onConversation);
    return () => this.conversationListeners.delete(onConversation);
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    this.messageListeners.clear();
    this.conversationListeners.clear();
  }

  async eraseLocalDatabase(): Promise<void> {
    this.erased = true;
    this.conversations.clear();
    this.messages.clear();
  }
}
