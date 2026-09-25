import { useEffect } from 'react';

import { wasProactive } from '@/runtime';
import { openChat } from '@/features/navigation/open';
import { isLocalConversation } from '../messaging/bots';
import { useChatStore, type ChatState } from '../messaging/chat-store';
import { contentPreview } from '../messaging/preview';
import type { ChatMessage, Conversation } from '../messaging/types';
import { totalUnread } from '../messaging/unread';
import {
  configureNotifications,
  notifyMessage,
  onNotificationTapped,
  setBadgeCount,
} from '../notifications';

export function useMessageNotifications() {
  useEffect(() => {
    configureNotifications();
  }, []);

  useEffect(() => {
    const since = Date.now();
    const badge = (state: ChatState) =>
      setBadgeCount(totalUnread(state.conversations, state.readAt, state.chatPrefs));
    badge(useChatStore.getState());
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.conversations !== previous.conversations ||
        state.readAt !== previous.readAt ||
        state.chatPrefs !== previous.chatPrefs
      ) {
        badge(state);
      }
      if (state.conversations === previous.conversations) return;

      for (const { conversation, message } of arrivals(
        previous.conversations,
        state.conversations,
        since
      )) {
        if (message.fromMe) continue;
        if (message.content.kind === 'system') continue;
        if (state.chatPrefs[conversation.id]?.muted) continue;
        if (isLocalConversation(conversation.id) && !wasProactive(message.id)) continue;

        notifyMessage({
          conversationId: conversation.id,
          title: conversation.title,
          body: contentPreview(message.content),
        });
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return onNotificationTapped((conversationId) => {
      openChat(conversationId);
    });
  }, []);
}

export function arrivals(
  previous: Conversation[],
  current: Conversation[],
  since: number
): { conversation: Conversation; message: ChatMessage }[] {
  const before = new Map(previous.map((c) => [c.id, c.lastMessage]));
  return current.flatMap((conversation) => {
    const message = conversation.lastMessage;
    const replaced = before.get(conversation.id);
    if (!message || message.id === replaced?.id) return [];
    if (message.sentAt <= Math.max(since, replaced?.sentAt ?? 0)) return [];
    return [{ conversation, message }];
  });
}
