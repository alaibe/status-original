import type { TdObject } from './api';
import { withPosition } from './chats';
import type { TdChat, TdChatPosition, TdMessage } from './types';

export const CHAT_PATCHES: Record<string, (chat: TdChat, update: TdObject) => void> = {
  updateChatPosition: (chat, update) => {
    chat.positions = withPosition(chat.positions, update.position as TdChatPosition);
  },
  updateChatTitle: (chat, update) => {
    chat.title = update.title as string;
  },
  updateChatPhoto: (chat, update) => {
    chat.photo = update.photo as TdChat['photo'];
  },
  updateChatLastMessage: (chat, update) => {
    chat.last_message = (update.last_message as TdMessage | null) ?? undefined;
    chat.positions = update.positions as TdChatPosition[];
  },
  updateChatReadInbox: (chat, update) => {
    chat.unread_count = update.unread_count as number;
  },
  updateChatUnreadMentionCount: (chat, update) => {
    chat.unread_mention_count = update.unread_mention_count as number;
  },
  updateChatPendingJoinRequests: (chat, update) => {
    chat.pending_join_requests = update.pending_join_requests as TdChat['pending_join_requests'];
  },
  updateChatDraftMessage: (chat, update) => {
    chat.draft_message = update.draft_message as TdChat['draft_message'];
    chat.positions = update.positions as TdChatPosition[];
  },
  updateChatIsMarkedAsUnread: (chat, update) => {
    chat.is_marked_as_unread = update.is_marked_as_unread as boolean;
  },
  updateChatPermissions: (chat, update) => {
    chat.permissions = update.permissions as TdChat['permissions'];
  },
  updateChatBlockList: (chat, update) => {
    chat.block_list = update.block_list as TdObject | null;
  },
};

const TYPING_TIMEOUT_MS = 6_000;

/** A start with no stop lapses on its own, as the Telegram apps treat it. */
export class TypingTracker {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private readonly onLapse: (chatId: number) => void) {}

  isTyping(chatId: number): boolean {
    return this.timers.has(chatId);
  }

  set(chatId: number, typing: boolean): void {
    clearTimeout(this.timers.get(chatId));
    this.timers.delete(chatId);
    if (!typing) return;
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        this.onLapse(chatId);
      }, TYPING_TIMEOUT_MS)
    );
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
