import { useEffect, useRef } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId } from '@/core/messaging/types';

const TYPING_TIMEOUT_MS = 5000;
const REANNOUNCE_MS = 3000;

export function useTypingAnnouncer(conversationId: ConversationId, enabled: boolean) {
  const setTyping = useChatStore((s) => s.setTyping);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedAt = useRef(0);

  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void setTyping(conversationId, false).catch(() => {});
    },
    [conversationId, setTyping]
  );

  const stop = () => {
    timer.current = null;
    announcedAt.current = 0;
    void setTyping(conversationId, false).catch(() => {});
  };

  return (text: string) => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    if (!text.trim()) {
      if (announcedAt.current) stop();
      timer.current = null;
      return;
    }
    const now = Date.now();
    if (now - announcedAt.current >= REANNOUNCE_MS) {
      announcedAt.current = now;
      void setTyping(conversationId, true).catch(() => {});
    }
    timer.current = setTimeout(stop, TYPING_TIMEOUT_MS);
  };
}
