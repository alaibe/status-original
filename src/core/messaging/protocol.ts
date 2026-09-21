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
import type { HistoryState } from './history';

/**
 * A protocol that signs in interactively (a phone number, a one-time code)
 * reports the step it is waiting on; null once signed in.
 */
export interface LoginState {
  step: 'phone' | 'code' | 'password';
  hint?: string;
  error?: string;
}

export interface ChatSession {
  readonly self: SelfIdentity;

  listConversations(): Promise<Conversation[]>;
  getMessages(
    id: ConversationId,
    opts?: { limit?: number; before?: { sentAt: number; id: MessageId } },
  ): Promise<ChatMessage[]>;

  resolvePeer(addressOrId: string): Promise<ParticipantId | null>;
  resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>>;
  /** Human names where the network has them; addresses are what gets copied. */
  resolveNames?(ids: ParticipantId[]): Promise<Record<ParticipantId, string>>;
  createDm(peer: ParticipantId): Promise<Conversation>;
  createGroup(peers: ParticipantId[], title: string): Promise<Conversation>;

  getMembers(id: ConversationId): Promise<GroupMember[]>;
  addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  renameGroup(id: ConversationId, title: string): Promise<void>;
  leaveGroup(id: ConversationId): Promise<void>;

  send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId>;

  setConsent?(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void>;

  sendReadReceipt?(id: ConversationId): Promise<void>;

  sync(): Promise<void>;
  subscribeHistory?(listener: (state: HistoryState) => void): Unsubscribe;

  subscribeLogin?(listener: (login: LoginState | null) => void): Unsubscribe;
  submitLogin?(value: string): Promise<void>;
  signOut?(): Promise<void>;

  streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe>;
  streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe>;

  disconnect(): Promise<void>;
}

export interface XmtpCapabilities {
  eraseLocalDatabase(): Promise<void>;
  listInstallations?(): Promise<{ id: string; createdAt?: number; current: boolean }[]>;
  revokeInstallations?(ids: string[]): Promise<void>;
}

export type GroupModel = 'enforced' | 'recipient-set' | 'topic';

export interface ChatProtocolMeta {
  trustModel: string;
  properties: {
    endToEndEncrypted: boolean;
    forwardSecrecy: boolean;
    metadataPrivacy: 'low' | 'medium' | 'high';
    maxGroupSize: number | 'unbounded';
    groupModel: GroupModel;
    durableHistory: boolean;
  };
}

export interface CustomContentType<T = any> {
  typeId: string;
  fallback: (data: T) => string;
}
