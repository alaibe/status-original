import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage, ConversationId } from '@/core/messaging/types';
import { useKeyedLoad } from '@/lib/use-keyed-load';

const NONE: ChatMessage[] = [];

/** A chat's pinned messages, fetched again whenever a loaded message is pinned or unpinned. */
export function usePinnedMessages(id: ConversationId, loaded: ChatMessage[], enabled: boolean) {
  const accountId = useChatStore((s) => s.accountId);
  const listPinnedMessages = useChatStore((s) => s.listPinnedMessages);
  const version = loaded
    .filter((message) => message.isPinned)
    .map((message) => message.id)
    .join('|');
  return useKeyedLoad(enabled && accountId ? id : null, listPinnedMessages, version).value ?? NONE;
}
