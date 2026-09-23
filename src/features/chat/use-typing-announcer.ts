import { useEffect, useRef } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId } from '@/core/messaging/types';

const TYPING_TIMEOUT_MS = 5000;

export function useTypingAnnouncer(conversationId: ConversationId, enabled: boolean) {
  const setTyping = useChatStore((s) => s.setTyping);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void setTyping(conversationId, false).catch(() => {});
    },
    [conversationId, setTyping]
  );

  return (text: string) => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    const typing = Boolean(text.trim());
    void setTyping(conversationId, typing).catch(() => {});
    timer.current = typing
      ? setTimeout(() => {
          timer.current = null;
          void setTyping(conversationId, false).catch(() => {});
        }, TYPING_TIMEOUT_MS)
      : null;
  };
}
