import { toast } from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import { openChat } from '@/features/navigation/open';
import type { KnownBridge } from '@/protocols/matrix/bridges';

const PROTOCOL = 'matrix';
const JOIN_TIMEOUT_MS = 20_000;

export function existingBotChat(botId: string) {
  return useChatStore
    .getState()
    .conversations.find(
      (c) => c.protocol === PROTOCOL && c.kind === 'dm' && c.memberIds.includes(botId)
    );
}

/** Opens a chat with the bridge bot and, once it has joined, sends the first sign-in command. */
export async function connectByChat(bridge: KnownBridge, botId: string): Promise<void> {
  const existing = existingBotChat(botId);
  if (existing) {
    openChat(existing.id);
    return;
  }
  const { startDm, sendMessage } = useChatStore.getState();
  try {
    const conversation = await startDm(PROTOCOL, botId);
    openChat(conversation.id);
    if (await hasJoined(conversation.id, botId)) {
      await sendMessage(conversation.id, { kind: 'text', text: bridge.firstCommand });
    } else {
      toast.error(
        `The ${bridge.network} bridge did not answer. Send it “${bridge.firstCommand}” once it joins.`
      );
    }
  } catch (e) {
    toast.error(errorMessage(e, `Could not reach the ${bridge.network} bridge`));
  }
}

async function hasJoined(conversationId: string, botId: string): Promise<boolean> {
  const deadline = Date.now() + JOIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const members = await useChatStore
      .getState()
      .getMembers(conversationId)
      .catch(() => []);
    if (members.some((member) => member.id === botId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}
