import type { Widget } from '@/design/widgets';

export type ConversationId = string;
export type MessageId = string;
export type ParticipantId = string;

export interface LiveView {
  pluginId: string;
  view: string;
  args?: string[];
}

export type WidgetContent = { kind: 'widget'; widget: Widget; fallback: string; live?: LiveView };

export type MessageContent =
  | { kind: 'text'; text: string }
  | WidgetContent
  | { kind: 'custom'; typeId: string; data: unknown; fallback?: string }
  | {
      kind: 'image';
      uri: string;
      width?: number;
      height?: number;
      size?: number;
      caption?: string;
      name?: string;
      mimeType?: string;
    }
  | {
      kind: 'file';
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
    }
  | {
      kind: 'voice';
      uri: string;
      durationMs: number;
      size?: number;
      name?: string;
      mimeType?: string;
    }
  | {
      kind: 'video';
      uri: string;
      width?: number;
      height?: number;
      durationMs?: number;
      caption?: string;
      name?: string;
      mimeType?: string;
      size?: number;
    }
  | {
      kind: 'poll';
      question: string;
      options: { text: string; percentage: number; chosen: boolean }[];
      totalVoters: number;
      multiple: boolean;
      closed: boolean;
    }
  | { kind: 'reaction'; targetId: MessageId; emoji: string; action: 'added' | 'removed' }
  | { kind: 'system'; text: string }
  | { kind: 'unsupported'; typeId: string; fallback: string };

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: MessageId;
  conversationId: ConversationId;
  senderId: ParticipantId;
  sentAt: number;
  content: MessageContent;
  fromMe: boolean;
  status: DeliveryStatus;
  replyTo?: MessageId;
  reactions?: Record<string, ParticipantId[]>;
  readAt?: number;
  forwarded?: boolean;
  isPinned?: boolean;
  privateToMe?: boolean;
  /** A chat list's summary of its latest message, under an id no message has. */
  preview?: boolean;
  edited?: boolean;
}

export type ConversationKind = 'dm' | 'group' | 'channel';

export type GroupRole = 'member' | 'admin' | 'owner';

export interface GroupMember {
  id: ParticipantId;
  role: GroupRole;
  muted?: boolean;
}

export interface Conversation {
  id: ConversationId;
  kind: ConversationKind;
  title: string;
  avatarUri?: string;
  memberIds: ParticipantId[];
  createdAt: number;
  lastMessage?: ChatMessage;
  unreadCount?: number;
  mentionCount?: number;
  markedUnread?: boolean;
  /** The draft the network keeps for this chat; empty when there is none. Unset where drafts stay on the device. */
  draft?: string;
  pendingJoinRequests?: number;
  canSend?: boolean;
  typing?: boolean;
  online?: boolean;
  lastSeenAt?: number;
  consent: 'allowed' | 'denied' | 'unknown';
  protocol?: string;
  /** Where the chat really lives when a bridge carries it: "Slack", "Discord". */
  network?: string;
  selfRole?: GroupRole;
  /** Unset where the network does not say; pinning is then offered and deleting others' messages is not. */
  canPin?: boolean;
  canDeleteOthers?: boolean;
}

export interface SelfIdentity {
  participantId: ParticipantId;
  address: string;
}

export type Unsubscribe = () => void;
