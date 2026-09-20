import type { ChatMessage, ParticipantId } from './types';

export function foldReactions(messages: ChatMessage[]): ChatMessage[] {
  const byTarget = new Map<string, Map<string, Set<ParticipantId>>>();

  for (const message of messages) {
    if (!message.reactions) continue;
    const emojis = new Map<string, Set<ParticipantId>>();
    for (const [emoji, people] of Object.entries(message.reactions)) {
      emojis.set(emoji, new Set(people));
    }
    byTarget.set(message.id, emojis);
  }

  for (const message of messages) {
    if (message.content.kind !== 'reaction') continue;
    const { targetId, emoji, action } = message.content;

    if (!byTarget.has(targetId)) byTarget.set(targetId, new Map());
    const emojis = byTarget.get(targetId)!;
    if (!emojis.has(emoji)) emojis.set(emoji, new Set());

    if (action === 'removed') emojis.get(emoji)!.delete(message.senderId);
    else emojis.get(emoji)!.add(message.senderId);
  }

  return messages
    .filter((m) => m.content.kind !== 'reaction')
    .map((message) => {
      const emojis = byTarget.get(message.id);
      if (!emojis) return message;

      const reactions: Record<string, ParticipantId[]> = {};
      for (const [emoji, people] of emojis) {
        if (people.size > 0) reactions[emoji] = [...people];
      }

      if (Object.keys(reactions).length > 0) return { ...message, reactions };
      if (!message.reactions) return message;
      const { reactions: _removed, ...rest } = message;
      return rest;
    });
}

export function hasReacted(
  message: ChatMessage,
  emoji: string,
  participantId: ParticipantId
): boolean {
  return message.reactions?.[emoji]?.includes(participantId) ?? false;
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
