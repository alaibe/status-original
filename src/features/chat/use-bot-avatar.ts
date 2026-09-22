import { botIdFromConversation, isLocalConversation, type Bot } from '@/core/messaging/bots';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId } from '@/core/messaging/types';

export function useBotAvatar(conversationId: ConversationId): Pick<Bot, 'avatar' | 'emoji'> {
  return (
    useChatStore((s) =>
      isLocalConversation(conversationId)
        ? s.bots[botIdFromConversation(conversationId)]
        : undefined
    ) ?? {}
  );
}
