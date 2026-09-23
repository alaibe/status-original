import type { ChatPrefsMap } from './chat-prefs';
import type { ChatMessage, Conversation, ConversationId } from './types';

/** Kept in `readAt` for a chat marked unread by hand: before any real read time. */
export const MARKED_UNREAD = -1;

export function countsAsUnread(message: ChatMessage, since: number): boolean {
  return (
    !message.fromMe &&
    message.content.kind !== 'system' &&
    message.content.kind !== 'reaction' &&
    message.sentAt > since
  );
}

export function isUnread(
  conversation: Conversation,
  readAt: Record<ConversationId, number>
): boolean {
  const since = readAt[conversation.id] ?? 0;
  if (since === MARKED_UNREAD) return true;
  const last = conversation.lastMessage;
  if (!last) return false;
  if (since >= last.sentAt) return false;
  return conversation.unreadCount === undefined
    ? countsAsUnread(last, since)
    : conversation.unreadCount > 0;
}

export function isCaughtUp(since: number, last: ChatMessage | undefined): boolean {
  return since !== MARKED_UNREAD && (!last || since >= last.sentAt);
}

/** The number on a chat's badge: the network's count, else the messages loaded here. */
export function unreadBadge(
  conversation: Conversation,
  since: number,
  loaded?: ChatMessage[]
): number {
  if (since === MARKED_UNREAD || isCaughtUp(since, conversation.lastMessage)) return 0;
  return conversation.unreadCount ?? (loaded ? unreadCount(loaded, since) : 0);
}

/** A network's mention count lingers until it hears the chat was read, which it may never. */
export function hasUnreadMentions(
  conversation: Conversation,
  readAt: Record<ConversationId, number>
): boolean {
  return (conversation.mentionCount ?? 0) > 0 && isUnread(conversation, readAt);
}

export function unreadCount(messages: ChatMessage[], since: number): number {
  if (since === MARKED_UNREAD) return 0;
  return messages.filter((m) => countsAsUnread(m, since)).length;
}

export function totalUnread(
  conversations: Conversation[],
  readAt: Record<ConversationId, number>,
  prefs: ChatPrefsMap
): number {
  return conversations.filter((c) => !prefs[c.id]?.muted && isUnread(c, readAt)).length;
}
