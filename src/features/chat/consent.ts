import { toast } from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId } from '@/core/messaging/types';

export type ConsentDecision = 'allowed' | 'denied';

export async function decideConsent(
  conversationId: ConversationId,
  consent: ConsentDecision
): Promise<void> {
  try {
    await useChatStore.getState().setConsent(conversationId, consent);
    toast.success(consent === 'allowed' ? 'Moved to your chats' : 'Request ignored');
  } catch (error) {
    toast.error(errorMessage(error, 'Could not do that'));
  }
}
