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
  /** Replaces the generic "Sign in to …" heading when the step means something more specific. */
  title?: string;
  hint?: string;
  error?: string;
}

export interface GroupInfo {
  description?: string;
  link?: string;
  memberCount?: number;
  avatarUri?: string;
  slowModeDelay?: number;
  canSetSlowMode?: boolean;
}

export interface PublicChatPreview extends GroupInfo {
  id: ConversationId;
  title: string;
  kind: 'group' | 'channel' | 'room';
  joined: boolean;
  requiresApproval?: boolean;
  joinUnavailableReason?: string;
}

export interface JoinRequest {
  userId: ParticipantId;
  name: string;
  bio?: string;
  requestedAt: number;
}

export interface MentionCandidate {
  id: ParticipantId;
  name: string;
  /** Inserted as typed where there is one; without, the mention is a link to the person. */
  handle?: string;
}

export interface ChatSession {
  readonly self: SelfIdentity;
  readonly sendsVideo?: boolean;
  /** Messages carry `threadRoot`, and `send` posts into a thread. */
  readonly threads?: boolean;
  readonly sendsCustom?: boolean;

  listConversations(): Promise<Conversation[]>;
  getMessages(
    id: ConversationId,
    opts?: { limit?: number; before?: { sentAt: number; id: MessageId } }
  ): Promise<ChatMessage[]>;
  searchMessages?(query: string, id?: ConversationId): Promise<ChatMessage[]>;
  countUnread?(id: ConversationId, since: number): Promise<number>;

  resolvePeer(addressOrId: string): Promise<ParticipantId | null>;
  resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>>;
  /** Human names where the network has them; addresses are what gets copied. */
  resolveNames?(ids: ParticipantId[]): Promise<Record<ParticipantId, string>>;
  mentionCandidates?(id: ConversationId, query: string): Promise<MentionCandidate[]>;
  createDm(peer: ParticipantId): Promise<Conversation>;
  createGroup(peers: ParticipantId[], title: string): Promise<Conversation>;
  previewPublicChat?(usernameOrLink: string): Promise<PublicChatPreview>;
  joinPublicChat?(id: ConversationId): Promise<Conversation | null>;
  createInviteLink?(id: ConversationId, requiresApproval: boolean): Promise<string>;
  getJoinRequests?(id: ConversationId): Promise<JoinRequest[]>;
  processJoinRequest?(id: ConversationId, userId: ParticipantId, approve: boolean): Promise<void>;

  getMembers(id: ConversationId): Promise<GroupMember[]>;
  getGroupInfo?(id: ConversationId): Promise<GroupInfo>;
  setSlowModeDelay?(id: ConversationId, seconds: number): Promise<void>;
  addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  /** Removes them and keeps them out, where removing alone lets them come back. */
  banMember?(id: ConversationId, peer: ParticipantId): Promise<void>;
  setMemberMuted?(id: ConversationId, peer: ParticipantId, muted: boolean): Promise<void>;
  renameGroup(id: ConversationId, title: string): Promise<void>;
  leaveGroup(id: ConversationId): Promise<void>;

  send(
    id: ConversationId,
    content: MessageContent,
    replyTo?: MessageId,
    threadRoot?: MessageId
  ): Promise<MessageId>;
  /** Emits the edited message through streamMessages when the server confirms it. */
  editMessage?(id: ConversationId, messageId: MessageId, text: string): Promise<void>;
  deleteMessage?(id: ConversationId, messageId: MessageId): Promise<void>;
  deleteMessageForMe?(id: ConversationId, messageId: MessageId): Promise<void>;
  votePoll?(id: ConversationId, messageId: MessageId, optionIds: number[]): Promise<void>;
  createPoll?(id: ConversationId, question: string, options: string[]): Promise<void>;
  listPinnedMessages?(id: ConversationId): Promise<ChatMessage[]>;
  setMessagePinned?(id: ConversationId, messageId: MessageId, pinned: boolean): Promise<void>;
  streamDeletedMessages?(
    listener: (id: ConversationId, messageIds: MessageId[]) => void
  ): Promise<Unsubscribe>;

  setConsent?(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void>;

  sendReadReceipt?(id: ConversationId): Promise<void>;
  setMarkedUnread?(id: ConversationId, unread: boolean): Promise<void>;
  saveDraft?(id: ConversationId, text: string): Promise<void>;
  setTyping?(id: ConversationId, typing: boolean): Promise<void>;
  /** For networks that only say who is online when asked; stops when the chat closes. */
  watchPresence?(id: ConversationId): Unsubscribe;

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
