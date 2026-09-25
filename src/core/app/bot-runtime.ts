import { botConversationId, toContent, type Bot, type BotContext } from '../messaging/bots';
import { useChatStore } from '../messaging/chat-store';
import type { MessageId } from '../messaging/types';
import { reportError } from './report-error';

interface RunningBot {
  stopped: boolean;
  dispose?: () => void;
}

const PROACTIVE_MEMORY = 200;

export class BotRuntime {
  private running = new Map<string, RunningBot>();
  private proactiveIds: MessageId[] = [];

  ids(): string[] {
    return [...this.running.keys()];
  }

  wasProactive(id: MessageId): boolean {
    return this.proactiveIds.includes(id);
  }

  sync(bots: Bot[], active: () => boolean): void {
    const wanted = new Map(bots.filter((bot) => bot.activate).map((bot) => [bot.id, bot]));
    for (const id of [...this.running.keys()]) if (!wanted.has(id)) this.stopOne(id);
    for (const [id, bot] of wanted) {
      if (!this.running.has(id)) this.start(bot, active);
    }
  }

  stop(): void {
    for (const id of [...this.running.keys()]) this.stopOne(id);
  }

  private start(bot: Bot, active: () => boolean): void {
    const conversationId = botConversationId(bot.id);
    const running: RunningBot = { stopped: false };
    this.running.set(bot.id, running);
    const context: BotContext = {
      conversationId,
      say: async (content) => {
        if (running.stopped || !active()) return;
        const chat = useChatStore.getState();
        if (!chat.conversations.some((conversation) => conversation.id === conversationId)) return;
        await chat.postLocalMessage(conversationId, toContent(content), 'bot');
        if (running.stopped || !active()) return;
        const posted = useChatStore.getState().messages[conversationId]?.at(-1);
        if (posted) {
          this.proactiveIds.push(posted.id);
          if (this.proactiveIds.length > PROACTIVE_MEMORY) this.proactiveIds.shift();
        }
      },
    };
    Promise.resolve()
      .then(() => bot.activate?.(context))
      .then((dispose) => {
        if (typeof dispose !== 'function') return;
        if (running.stopped) dispose();
        else running.dispose = dispose;
      })
      .catch((error) => {
        console.warn(`[bots] "${bot.id}" failed to activate`, error);
        reportError(error);
        if (this.running.get(bot.id) === running) this.stopOne(bot.id);
      });
  }

  private stopOne(id: string): void {
    const running = this.running.get(id);
    if (!running) return;
    running.stopped = true;
    this.running.delete(id);
    try {
      running.dispose?.();
    } catch (error) {
      console.warn(`[bots] "${id}" failed to stop`, error);
    }
  }
}
