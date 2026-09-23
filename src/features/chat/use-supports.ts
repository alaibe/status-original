import { type Capability, supports } from '@/core/messaging/capability';
import { sessionFor, useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId } from '@/core/messaging/types';

export function useSupports(conversationId: ConversationId | undefined) {
  const session = useChatStore((s) => sessionFor(s, conversationId));
  return {
    session,
    supports: (key: Capability) => supports(session, key),
    sendsVideo: Boolean(session?.sendsVideo),
  };
}
