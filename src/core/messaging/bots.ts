import type { ConversationId, MessageContent } from './types';

export const LOCAL_PREFIX = 'local-';

export function botConversationId(botId: string): ConversationId {
  return `${LOCAL_PREFIX}${botId}`;
}

export function isLocalConversation(id: ConversationId): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

export function isParticipantId(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function botIdFromConversation(id: ConversationId): string {
  return id.slice(LOCAL_PREFIX.length);
}

export const STATUS_LOCAL_ID = botConversationId('status');

export interface BotContext {
  conversationId: ConversationId;
  say(content: MessageContent | string): Promise<void>;
}

export type BotDisposer = void | (() => void);

export interface Bot {
  id: string;
  name: string;
  tagline: string;
  /** A bundled image, as `require` returns it. Without one the room gets initials. */
  avatar?: number;
  emoji?: string;
  greeting(): (MessageContent | string)[];
  onMessage?(text: string, context: BotContext): Promise<void>;
  activate?(context: BotContext): BotDisposer | Promise<BotDisposer>;
}

export function poll(
  everyMs: number,
  tick: (context: BotContext) => Promise<void>
): (context: BotContext) => () => void {
  return (context) => {
    let stopped = false;

    const run = async () => {
      if (stopped) return;
      try {
        await tick(context);
      } catch (error) {
        console.warn('[bots] poll failed', error);
      }
    };

    void run();
    const timer = setInterval(run, everyMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  };
}

export function toContent(value: MessageContent | string): MessageContent {
  return typeof value === 'string' ? { kind: 'text', text: value } : value;
}
