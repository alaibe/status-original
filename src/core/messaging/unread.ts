import type { ChatPrefsMap } from './chat-prefs';
import type { ChatMessage, Conversation, ConversationId } from './types';

function arrivedUnread(message: ChatMessage, since: number): boolean {
  return !message.fromMe && message.content.kind !== 'system' && message.sentAt > since;
}

export function isUnread(
  conversation: Conversation,
  readAt: Record<ConversationId, number>
): boolean {
  const last = conversation.lastMessage;
  return last !== undefined && arrivedUnread(last, readAt[conversation.id] ?? 0);
}

export function unreadCount(messages: ChatMessage[], since: number): number {
  return messages.filter((m) => arrivedUnread(m, since)).length;
}

export function totalUnread(
  conversations: Conversation[],
  readAt: Record<ConversationId, number>,
  prefs: ChatPrefsMap
): number {
  return conversations.filter((c) => !prefs[c.id]?.muted && isUnread(c, readAt)).length;
}
