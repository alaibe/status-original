import type { Conversation, ConversationId } from './types';

export function isUnread(
  conversation: Conversation,
  readAt: Record<ConversationId, number>
): boolean {
  const last = conversation.lastMessage;
  if (!last || last.fromMe) return false;
  if (last.content.kind === 'system') return false;

  return last.sentAt > (readAt[conversation.id] ?? 0);
}

export function totalUnread(
  conversations: Conversation[],
  readAt: Record<ConversationId, number>
): number {
  return conversations.filter((c) => isUnread(c, readAt)).length;
}
