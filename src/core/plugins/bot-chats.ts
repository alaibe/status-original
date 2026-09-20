import { botConversationId, type Bot } from '../messaging/bots';
import type { ChatMessage, ConversationId } from '../messaging/types';

export interface BotChatLoss {
  conversationIds: ConversationId[];
  botNames: string[];
  fromYou: number;
  total: number;
}

export function botChatLoss(
  bots: Bot[],
  messages: Record<ConversationId, ChatMessage[]>
): BotChatLoss | null {
  const loss: BotChatLoss = { conversationIds: [], botNames: [], fromYou: 0, total: 0 };

  for (const bot of bots) {
    const id = botConversationId(bot.id);
    const transcript = messages[id] ?? [];
    if (transcript.length === 0) continue;

    const fromYou = transcript.filter((m) => m.fromMe).length;
    const untouched = fromYou === 0 && transcript.length <= bot.greeting().length;
    if (untouched) continue;

    loss.conversationIds.push(id);
    loss.botNames.push(bot.name);
    loss.fromYou += fromYou;
    loss.total += transcript.length;
  }

  return loss.conversationIds.length > 0 ? loss : null;
}

export interface BotChatLossCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

export function botChatLossCopy(pluginName: string, loss: BotChatLoss): BotChatLossCopy {
  const chats = loss.botNames.join(' and ');
  const plural = loss.conversationIds.length === 1 ? 'chat' : 'chats';
  const written =
    loss.fromYou > 0
      ? `, ${loss.fromYou} of which ${loss.fromYou === 1 ? 'is' : 'are'} yours`
      : '';

  return {
    title: `Turn off ${pluginName}?`,
    body:
      `The ${chats} ${plural} will leave your list, along with ${loss.total} ` +
      `message${loss.total === 1 ? '' : 's'}${written}.\n\n` +
      `Nothing is deleted. The transcript stays on this device and comes back exactly ` +
      `as it was the moment you turn ${pluginName} on again.`,
    confirmLabel: `Turn off ${pluginName}`,
  };
}
