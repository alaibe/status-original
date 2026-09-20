import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  View,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChatBackground,
  EmptyState,
  Icon,
  Pressable,
  Text,
  toast,
  useThemeColors,
} from '@/design';
import { botIdFromConversation, isLocalConversation } from '@/core/messaging/bots';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage , MessageContent } from '@/core/messaging/types';
import { useAppearanceStore } from '@/core/app/appearance';
import { useBack } from '@/features/navigation/use-back';
import { contentPreview, isNewDay } from '@/core/messaging/preview';
import { errorMessage } from '@/core/errors';
import { Composer } from '@/features/chat/composer';
import { ConsentBar } from '@/features/chat/consent-bar';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { DateSeparator } from '@/features/chat/date-separator';
import { CommandPending } from '@/features/chat/command-pending';
import { ForwardSheet } from '@/features/chat/forward-sheet';
import { MessageBubble } from '@/features/chat/message-bubble';
import {
  conversationPeers,
  conversationTitle,
  useDisplayNames,
} from '@/features/chat/use-display-names';
import { protocolSubtitle } from '@/features/protocols/presentation';
import { HistoryStatus } from '@/features/chat/history-status';

const GROUP_WINDOW_MS = 60_000;

const NO_MESSAGES: ChatMessage[] = [];

const MISSING_REPLY = { author: '', preview: 'Original message' };

type ReplyPreview = { author: string; preview: string };

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const goBack = useBack('/chats');
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const sessions = useChatStore((s) => s.sessions);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const fetchingHistory = useChatStore((s) =>
    !!conversation?.protocol && s.protocols[conversation.protocol]?.history?.status === 'fetching'
  );
  const messages = useChatStore((s) => s.messages[id]) ?? NO_MESSAGES;
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const messageHistory = useChatStore((s) => s.messageHistory[id]);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const react = useChatStore((s) => s.react);
  const markRead = useChatStore((s) => s.markRead);

  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);

  const selfId = selfIdFor({ sessions }, conversation?.protocol);

  const isBot = isLocalConversation(id);

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (messages.length > 0 || conversation !== undefined) markInteractive();
  }, [messages.length, conversation, markInteractive]);
  const botTagline = useChatStore((s) =>
    isBot ? s.bots[botIdFromConversation(id)]?.tagline : undefined
  );

  const peers = useMemo(
    () => (conversation ? conversationPeers(conversation, selfId) : []),
    [conversation, selfId]
  );
  const { nameFor } = useDisplayNames(peers);

  const accountId = useChatStore((s) => s.accountId);
  useEffect(() => {
    if (id && accountId) loadMessages(id);
  }, [id, accountId, loadMessages]);

  const newest = messages[messages.length - 1];
  const newestFromPeer = newest && !newest.fromMe ? newest.id : null;
  useEffect(() => {
    if (id && newestFromPeer) markRead(id);
  }, [id, markRead, newestFromPeer]);

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const runCommand = useCallback((command: string) => setPendingCommand(command), []);
  const clearPendingCommand = useCallback(() => setPendingCommand(null), []);

  const onSendContent = useCallback(
    async (content: MessageContent) => {
      await sendMessage(id, content);
    },
    [id, sendMessage]
  );

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const previewOf = useCallback(
    (target: ChatMessage): ReplyPreview => ({
      author: target.fromMe ? 'You' : nameFor(target.senderId),
      preview: contentPreview(target.content) || 'Message',
    }),
    [nameFor]
  );

  const replyPreview = useMemo(() => {
    const target = replyTo ? byId.get(replyTo) : undefined;
    return target ? { id: target.id, ...previewOf(target) } : null;
  }, [replyTo, byId, previewOf]);

  const onSendText = useCallback(
    async (text: string) => {
      await sendMessage(id, { kind: 'text', text }, replyTo ?? undefined);
      setReplyTo(null);
    },
    [id, sendMessage, replyTo]
  );

  const onRetryId = useCallback(
    (messageId: string) => void retryMessage(id, messageId),
    [id, retryMessage]
  );
  const onReactTo = useCallback(
    (messageId: string, emoji: string) => {
      react(id, messageId, emoji).catch((e) => toast.error(errorMessage(e, 'Could not react')));
    },
    [id, react]
  );

  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const isGroup = conversation?.kind === 'group';
  const botName = conversation?.title ?? 'Bot';
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMessage>) => (
      <MessageRow
        message={item}
        previous={reversed[index + 1]}
        replyTarget={item.replyTo ? byId.get(item.replyTo) : undefined}
        senderName={isBot ? botName : nameFor(item.senderId)}
        isGroup={isGroup}
        previewOf={previewOf}
        onCommand={runCommand}
        onReplyTo={setReplyTo}
        onForwardMessage={setForwarding}
        onRetryId={onRetryId}
        onReactTo={onReactTo}
      />
    ),
    [reversed, byId, isBot, botName, nameFor, isGroup, previewOf, runCommand, onRetryId, onReactTo]
  );

  const title = conversation
    ? conversationTitle(conversation, selfId, nameFor)
    : 'Conversation';

  return (
    <View className="flex-1 bg-canvas">
      <ChatBackground pattern={wallpaper} />

      <View
        className="absolute left-0 right-0 top-0 z-10 flex-row items-center gap-2 px-3"
        style={{ paddingTop: insets.top + 6, paddingBottom: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          className="h-10 w-10 items-center justify-center overflow-hidden rounded-pill">
          <BlurView
            intensity={40}
            tint={colors.scheme === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View className="absolute inset-0 bg-canvas/55" />
          <Icon name="chevron-back" size={22} color={colors.brand} />
        </Pressable>

        <Pressable
          // The pressable collapses its children into one accessibility element, so the
          // label has to name the room itself.
          testID={`chat-header-${id}`}
          accessibilityRole="button"
          accessibilityLabel={`${title}. Conversation details`}
          disabled={isBot}
          onPress={() => router.push(`/profile/${id}`)}
          className="flex-1 items-center">
          <View className="max-w-full overflow-hidden rounded-pill px-4 py-1.5">
            <BlurView
              intensity={40}
              tint={colors.scheme === 'dark' ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View className="absolute inset-0 bg-canvas/55" />
            <Text className="text-center font-semibold" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="micro" numberOfLines={1} className="text-center">
              {isBot
                ? (botTagline ?? 'On this device only')
                : conversation?.kind === 'group'
                  ? `${conversation.memberIds.length} members · ${protocolSubtitle(conversation?.protocol)}`
                  : protocolSubtitle(conversation?.protocol)}
            </Text>
          </View>
        </Pressable>

        {conversation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conversation details"
            disabled={isBot}
            onPress={() => router.push(`/profile/${id}`)}>
            <ConversationAvatar conversation={conversation} selfId={selfId} size="md" />
          </Pressable>
        ) : (
          <View className="h-10 w-10" />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        {reversed.length === 0 ? (
          <View className="flex-1">
            <HistoryStatus protocol={conversation?.protocol} />
            <EmptyState
            icon={
              <Icon
                name={isBot ? 'sparkles-outline' : 'lock-closed-outline'}
                size={40}
                color={colors['content-subtle']}
              />
            }
            title={fetchingHistory ? 'Fetching history…' : 'No messages yet'}
            description={
              isBot
                ? 'Type /commands to see what you can do in this chat.'
                : 'Messages are end-to-end encrypted. Type /commands to see what you can do here.'
            }
            />
          </View>
        ) : (
          <FlatList
            inverted
            data={reversed}
            keyExtractor={(m) => m.id}
            ListHeaderComponent={running ? <CommandPending label={`Running ${running}…`} /> : null}
            ListFooterComponent={
              <View>
                {messageHistory?.hasOlder ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messageHistory.error ? `Retry loading earlier messages. ${messageHistory.error}` : 'Load earlier messages'}
                    disabled={messageHistory.loading}
                    onPress={() => void loadOlderMessages(id)}
                    className="items-center px-gutter py-3">
                    <Text variant="caption" className={messageHistory.error ? 'text-danger' : undefined}>
                      {messageHistory.loading
                        ? 'Loading earlier messages…'
                        : messageHistory.error
                          ? `${messageHistory.error} · Retry`
                          : 'Load earlier messages'}
                    </Text>
                  </Pressable>
                ) : null}
                {!isBot && conversation?.protocol ? <HistoryStatus protocol={conversation.protocol} /> : null}
              </View>
            }
            contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.top + 62 }}
            keyboardDismissMode="interactive"
            renderItem={renderItem}
          />
        )}

        <View style={{ paddingBottom: insets.bottom }}>
          {conversation?.consent === 'unknown' ? (
            <ConsentBar conversationId={id} />
          ) : (
          <Composer
            conversationId={id}
            onSendText={onSendText}
            onSendContent={onSendContent}
            replyTo={replyPreview}
            onCancelReply={() => setReplyTo(null)}
            pendingCommand={pendingCommand}
            onPendingCommandHandled={clearPendingCommand}
            onRunningChange={setRunning}
          />
          )}
        </View>
      </KeyboardAvoidingView>

      <ForwardSheet
        message={forwarding}
        from={id}
        nameFor={nameFor}
        onClose={() => setForwarding(null)}
      />
    </View>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  previous,
  replyTarget,
  senderName,
  isGroup,
  previewOf,
  onCommand,
  onReplyTo,
  onForwardMessage,
  onRetryId,
  onReactTo,
}: {
  message: ChatMessage;
  previous: ChatMessage | undefined;
  replyTarget: ChatMessage | undefined;
  senderName: string;
  isGroup: boolean;
  previewOf: (target: ChatMessage) => ReplyPreview;
  onCommand: (command: string) => void;
  onReplyTo: (id: string) => void;
  onForwardMessage: (message: ChatMessage) => void;
  onRetryId: (id: string) => void;
  onReactTo: (id: string, emoji: string) => void;
}) {
  const grouped =
    !!previous &&
    previous.senderId === message.senderId &&
    message.sentAt - previous.sentAt < GROUP_WINDOW_MS &&
    previous.content.kind !== 'system';

  const startsNewDay = isNewDay(previous?.sentAt, message.sentAt);

  return (
    <>
      {startsNewDay ? <DateSeparator at={message.sentAt} /> : null}
      <MessageBubble
        message={message}
        grouped={grouped && !startsNewDay}
        senderName={senderName}
        showSender={isGroup && !grouped && !message.privateToMe}
        onCommand={onCommand}
        onReply={message.privateToMe ? undefined : () => onReplyTo(message.id)}
        onForward={() => onForwardMessage(message)}
        onRetry={message.status === 'failed' ? () => onRetryId(message.id) : undefined}
        replyPreview={
          message.replyTo ? (replyTarget ? previewOf(replyTarget) : MISSING_REPLY) : undefined
        }
        onReact={message.privateToMe ? undefined : (emoji) => onReactTo(message.id, emoji)}
      />
    </>
  );
});
