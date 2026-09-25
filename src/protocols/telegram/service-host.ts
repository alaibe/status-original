import type { ChatMessage, Conversation } from '@/core/messaging/types';

import type { TdApi } from './api';
import type { TdDirectory } from './directory';
import type { TdChat, TdMessage } from './types';

export interface TelegramHost {
  api(): TdApi;
  readonly td: TdDirectory;
  toConversation(chat: TdChat): Conversation;
  selfUserId(): number | undefined;
  toMessage(raw: TdMessage, fetchMedia: boolean): ChatMessage;
  refetch(chatId: number, messageId: number): Promise<void>;
  emitMessage(raw: TdMessage): Promise<void>;
}
