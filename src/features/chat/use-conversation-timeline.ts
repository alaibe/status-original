import { useObserve } from 'expo-observe';
import { type FlashListRef } from '@shopify/flash-list';
import { useEffect, useMemo, useRef } from 'react';

import { toast } from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatSession } from '@/core/messaging/protocol';
import type { ChatMessage, Conversation, ConversationId, MessageId } from '@/core/messaging/types';
import { MARKED_UNREAD } from '@/core/messaging/unread';
import { useJumpStore } from './jump-store';

const NO_MESSAGES: ChatMessage[] = [];

export function useConversationTimeline(
  id: ConversationId,
  thread: MessageId | undefined,
  conversation: Conversation | undefined,
  session: ChatSession | undefined,
  countReplies: boolean
) {
  const accountId = useChatStore((s) => s.accountId);
  const allMessages = useChatStore((s) => s.messages[id]) ?? NO_MESSAGES;
  const messageHistory = useChatStore((s) => s.messageHistory[id]);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const watchPresence = useChatStore((s) => s.watchPresence);
  const markRead = useChatStore((s) => s.markRead);
  const marked = useChatStore((s) => s.readAt[id] === MARKED_UNREAD);

  const messages = useMemo(() => {
    if (!thread) return allMessages.filter((message) => !message.threadRoot);
    const root = allMessages.find((message) => message.id === thread);
    return [
      ...(root ? [root] : []),
      ...allMessages.filter((message) => message.threadRoot === thread),
    ];
  }, [allMessages, thread]);
  const byId = new Map(allMessages.map((message) => [message.id, message]));
  const replyCounts = new Map<MessageId, number>();
  if (countReplies) {
    for (const message of allMessages) {
      if (message.threadRoot) {
        replyCounts.set(message.threadRoot, (replyCounts.get(message.threadRoot) ?? 0) + 1);
      }
    }
  }

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (messages.length > 0 || conversation !== undefined) markInteractive();
  }, [messages.length, conversation, markInteractive]);

  useEffect(() => {
    if (id && accountId && !thread) loadMessages(id);
  }, [id, thread, accountId, loadMessages]);

  useEffect(
    () => (session && !thread ? watchPresence(id) : undefined),
    [id, thread, session, watchPresence]
  );

  const newest = allMessages[allMessages.length - 1];
  const newestFromPeer = newest && !newest.fromMe ? newest.id : null;
  useEffect(() => {
    if (id && !thread && (newestFromPeer || marked)) markRead(id);
  }, [id, thread, markRead, newestFromPeer, marked]);

  const list = useRef<FlashListRef<ChatMessage>>(null);
  const following = useRef(true);
  const followNewest = () => {
    following.current = true;
    list.current?.scrollToEnd({ animated: true });
  };
  const pauseFollowing = () => {
    following.current = false;
  };
  const followIfNeeded = () => {
    if (following.current) list.current?.scrollToEnd({ animated: false });
  };

  const jump = useJumpStore((s) => (!thread && s.target?.conversationId === id ? s.target : null));
  const highlighted = useJumpStore((s) => s.landed);
  const land = useJumpStore((s) => s.land);
  useEffect(() => {
    if (!jump) return;
    following.current = false;
    const index = messages.findIndex((message) => message.id === jump.id);
    if (index >= 0) {
      land(jump.id);
      requestAnimationFrame(
        () => void list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 })
      );
      return;
    }
    if (!messageHistory || messageHistory.loading) return;
    const oldest = messages[0];
    if (
      oldest &&
      oldest.sentAt >= jump.sentAt &&
      messageHistory.hasOlder &&
      !messageHistory.error
    ) {
      void loadOlderMessages(id);
    } else {
      land(null);
      toast.error('Could not find that message in this chat');
    }
  }, [id, jump, messages, messageHistory, loadOlderMessages, land]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => land(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted, land]);

  return {
    allMessages,
    messages,
    byId,
    replyCounts,
    messageHistory,
    loadOlderMessages,
    list,
    followNewest,
    pauseFollowing,
    followIfNeeded,
    highlighted,
  };
}
