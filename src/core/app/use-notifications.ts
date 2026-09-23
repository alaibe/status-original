import { useEffect } from 'react';

import { wasProactive } from '@/runtime';
import { openChat } from '@/features/navigation/open';
import { isLocalConversation } from '../messaging/bots';
import { useChatStore, type ChatState } from '../messaging/chat-store';
import { contentPreview } from '../messaging/preview';
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

      const seen = new Map(previous.conversations.map((c) => [c.id, c.lastMessage]));
      const conversation = state.conversations.find(
        (c) => c.lastMessage && c.lastMessage !== seen.get(c.id)
      );
      if (!conversation?.lastMessage) return;

      const message = conversation.lastMessage;
      if (message.fromMe) return;
      if (message.content.kind === 'system') return;
      if (state.chatPrefs[conversation.id]?.muted) return;
      if (isLocalConversation(conversation.id) && !wasProactive(message.id)) return;

      notifyMessage({
        conversationId: conversation.id,
        title: conversation.title,
        body: contentPreview(message.content),
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return onNotificationTapped((conversationId) => {
      openChat(conversationId);
    });
  }, []);
}
