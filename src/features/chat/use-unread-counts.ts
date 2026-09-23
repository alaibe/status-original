import { useEffect, useState } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import { splitConversationId } from '@/core/messaging/namespace';
import type { Conversation } from '@/core/messaging/types';
import { isCaughtUp, MARKED_UNREAD } from '@/core/messaging/unread';

interface Counted {
  key: string;
  count?: number;
}

/**
 * Unread counts for chats whose network reports none, asked of the session.
 * A chat is recounted only when its last message or read time changes.
 */
export function useUnreadCounts(conversations: Conversation[]): Conversation[] {
  const readAt = useChatStore((s) => s.readAt);
  const [counted, setCounted] = useState<Record<string, Counted>>({});

  const keyOf = (c: Conversation) => `${c.lastMessage?.id}@${readAt[c.id] ?? 0}`;
  const stale = conversations
    .filter(
      (c) =>
        c.unreadCount === undefined &&
        readAt[c.id] !== MARKED_UNREAD &&
        !isCaughtUp(readAt[c.id] ?? 0, c.lastMessage) &&
        counted[c.id]?.key !== keyOf(c)
    )
    .map((c) => `${c.id} ${keyOf(c)}`)
    .join('\n');

  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    const { sessions, readAt } = useChatStore.getState();
    Promise.all(
      stale.split('\n').map(async (line) => {
        const [id, key] = line.split(' ');
        const route = splitConversationId(id);
        const countUnread = route && sessions[route.protocol]?.countUnread;
        const count =
          route && countUnread
            ? await countUnread
                .call(sessions[route.protocol], route.nativeId, readAt[id] ?? 0)
                .catch(() => undefined)
            : undefined;
        return [id, { key, count }] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      setCounted((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    });
    return () => {
      cancelled = true;
    };
  }, [stale]);

  return conversations.map((c) =>
    c.unreadCount === undefined &&
    counted[c.id]?.key === keyOf(c) &&
    counted[c.id].count !== undefined
      ? { ...c, unreadCount: counted[c.id].count }
      : c
  );
}
