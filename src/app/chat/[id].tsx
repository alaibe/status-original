import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';

import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChatBackground,
  ConfirmSheet,
  EmptyState,
  Icon,
  Pressable,
  Text,
  toast,
  useLayoutInsets,
  useThemeColors,
} from '@/design';
import { botIdFromConversation, isLocalConversation } from '@/core/messaging/bots';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage, MessageContent } from '@/core/messaging/types';
import { useAppearanceStore } from '@/core/app/appearance';
import { useBack } from '@/features/navigation/use-back';
import { contentPreview, isNewDay } from '@/core/messaging/preview';
import { MARKED_UNREAD } from '@/core/messaging/unread';
import { errorMessage } from '@/core/errors';
import { Composer } from '@/features/chat/composer';
import { ConsentBar } from '@/features/chat/consent-bar';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { DateSeparator } from '@/features/chat/date-separator';
import { CommandPending } from '@/features/chat/command-pending';
import { ForwardSheet } from '@/features/chat/forward-sheet';
import { headerSubtitle } from '@/features/chat/header-subtitle';
import { MessageBubble, type ReplyPreview } from '@/features/chat/message-bubble';
import { conversationPeers, conversationTitle } from '@/core/messaging/display-names';
import { useDisplayNames } from '@/features/chat/use-display-names';
import { useSupports } from '@/features/chat/use-supports';
import { useComposerMode } from '@/features/chat/composer-mode';
import { useAction } from '@/features/chat/use-action';
import { usePinnedMessages } from '@/features/chat/use-pinned-messages';
import type { MessageAction } from '@/features/chat/message-actions';
import {
  type ActionSupport,
  type ConversationActions,
  messageActions,
} from '@/features/chat/message-commands';
import { HistoryStatus } from '@/features/chat/history-status';
import { useJumpStore } from '@/features/chat/jump-store';
import { PinnedMessages } from '@/features/chat/pinned-messages';

const GROUP_WINDOW_MS = 60_000;

const NO_MESSAGES: ChatMessage[] = [];

const MISSING_REPLY = { author: '', preview: 'Original message' };

const DELETE_COPY = {
  everyone: {
    title: 'Delete message for everyone?',
    body: 'This removes the message for everyone in the chat.',
    label: 'Delete for everyone',
  },
  me: {
    title: 'Delete message for you?',
    body: 'This removes the message from your account. The others in the chat keep it.',
    label: 'Delete for me',
  },
};

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  // On desktop the frame draws the wallpaper and the sidebar does the navigating.
  const desktop = process.env.EXPO_OS === 'web';
  const goBack = useBack('/chats');
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const frame = useLayoutInsets();

  const sessions = useChatStore((s) => s.sessions);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const fetchingHistory = useChatStore(
    (s) =>
      !!conversation?.protocol && s.protocols[conversation.protocol]?.history?.status === 'fetching'
  );
  const messages = useChatStore((s) => s.messages[id]) ?? NO_MESSAGES;
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const messageHistory = useChatStore((s) => s.messageHistory[id]);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const react = useChatStore((s) => s.react);
  const votePoll = useChatStore((s) => s.votePoll);
  const setMessagePinned = useChatStore((s) => s.setMessagePinned);
  const ingestMessage = useChatStore((s) => s.ingestMessage);
  const markRead = useChatStore((s) => s.markRead);
  const watchPresence = useChatStore((s) => s.watchPresence);
  const muted = useChatStore((s) => Boolean(s.chatPrefs[id]?.muted));
  const setChatPref = useChatStore((s) => s.setChatPref);

  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<{ message: ChatMessage; forEveryone: boolean } | null>(
    null
  );
  const [showPinned, setShowPinned] = useState(false);

  const selfId = selfIdFor({ sessions }, conversation?.protocol);

  const isBot = isLocalConversation(id);

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (messages.length > 0 || conversation !== undefined) markInteractive();
  }, [messages.length, conversation, markInteractive]);
  const botTagline = useChatStore((s) =>
    isBot ? s.bots[botIdFromConversation(id)]?.tagline : undefined
  );

  const peers = conversation ? conversationPeers(conversation, selfId) : [];
  const { nameFor } = useDisplayNames(peers);

  const accountId = useChatStore((s) => s.accountId);
  const { session, supports } = useSupports(id);
  const pinnedMessages = usePinnedMessages(id, messages, supports('listPinnedMessages'));
  const deleteCopy = DELETE_COPY[deleting?.forEveryone ? 'everyone' : 'me'];
  const remove = useAction(
    ({ message, forEveryone }: { message: ChatMessage; forEveryone: boolean }) =>
      deleteMessage(id, message.id, forEveryone),
    {
      failure: 'Could not delete message',
    }
  );
  useEffect(() => {
    if (id && accountId) loadMessages(id);
  }, [id, accountId, loadMessages]);

  useEffect(() => (session ? watchPresence(id) : undefined), [id, session, watchPresence]);

  const newest = messages[messages.length - 1];
  const newestFromPeer = newest && !newest.fromMe ? newest.id : null;
  const marked = useChatStore((s) => s.readAt[id] === MARKED_UNREAD);
  useEffect(() => {
    if (id && (newestFromPeer || marked)) markRead(id);
  }, [id, markRead, newestFromPeer, marked]);

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const runCommand = (command: string) => setPendingCommand(command);
  const clearPendingCommand = () => setPendingCommand(null);

  const list = useRef<FlashListRef<ChatMessage>>(null);
  const following = useRef(true);
  const followNewest = () => {
    following.current = true;
    list.current?.scrollToEnd({ animated: true });
  };

  const jump = useJumpStore((s) => (s.target?.conversationId === id ? s.target : null));
  const highlighted = useJumpStore((s) => s.landed);
  const land = useJumpStore((s) => s.land);
  useEffect(() => {
    if (!jump) return;
    following.current = false;
    const index = messages.findIndex((m) => m.id === jump.id);
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

  const onSendContent = async (content: MessageContent) => {
    followNewest();
    await sendMessage(id, content);
  };

  const byId = new Map(messages.map((m) => [m.id, m]));

  const previewOf = (target: ChatMessage): ReplyPreview => ({
    author: target.fromMe ? 'You' : nameFor(target.senderId),
    preview: contentPreview(target.content) || 'Message',
  });

  const composer = useComposerMode(id, followNewest);

  const onReactTo = (messageId: string, emoji: string) => {
    react(id, messageId, emoji).catch((e) => toast.error(errorMessage(e, 'Could not react')));
  };
  const onPinMessage = async (message: ChatMessage) => {
    try {
      const isPinned = !message.isPinned;
      await setMessagePinned(id, message.id, isPinned);
      ingestMessage({ ...message, isPinned });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not change pinned message'));
    }
  };

  const isGroup = conversation?.kind === 'group';
  const botName = conversation?.title ?? 'Bot';
  const handlers: ConversationActions = {
    reply: (message) => composer.reply(message),
    forward: setForwarding,
    edit: (message) => composer.edit(message),
    remove: (message, forEveryone) => setDeleting({ message, forEveryone }),
    retry: (message) => void retryMessage(id, message.id),
    togglePin: (message) => void onPinMessage(message),
  };
  const can: ActionSupport = {
    edit: supports('editMessage'),
    delete: supports('deleteMessage'),
    deleteForMe: supports('deleteMessageForMe'),
    deleteOthers: conversation?.canDeleteOthers ?? false,
    pin: supports('setMessagePinned') && conversation?.canPin !== false,
  };
  const canVote = supports('votePoll');

  const renderItem = ({ item, index }: ListRenderItemInfo<ChatMessage>) => (
    <MessageRow
      message={item}
      previous={messages[index - 1]}
      highlighted={item.id === highlighted}
      replyTarget={item.replyTo ? byId.get(item.replyTo) : undefined}
      senderName={isBot ? botName : nameFor(item.senderId)}
      isGroup={isGroup}
      previewOf={previewOf}
      onCommand={runCommand}
      actions={messageActions(item, handlers, can)}
      onReact={item.privateToMe ? undefined : (emoji) => onReactTo(item.id, emoji)}
      onVote={canVote ? (optionIds) => votePoll(id, item.id, optionIds) : undefined}
    />
  );

  const title = conversation ? conversationTitle(conversation, selfId, nameFor) : 'Conversation';

  return (
    <View className={desktop ? 'flex-1' : 'flex-1 bg-canvas'}>
      {desktop ? null : <ChatBackground pattern={wallpaper} />}

      <View
        className="absolute left-0 right-0 top-0 z-10 flex-row items-center gap-2 px-3"
        style={{ paddingTop: insets.top + frame.top + 6, paddingBottom: 8 }}>
        {desktop ? null : (
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
        )}

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
              {isBot ? (botTagline ?? 'On this device only') : headerSubtitle(conversation)}
            </Text>
          </View>
        </Pressable>

        {conversation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search in chat"
            onPress={() => router.push(`/search?chatId=${encodeURIComponent(id)}`)}
            className="h-10 w-10 items-center justify-center">
            <Icon name="search-outline" size={20} color={colors.brand} />
          </Pressable>
        ) : null}

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

      <PinnedMessages
        messages={pinnedMessages}
        visible={showPinned}
        onOpen={() => setShowPinned(true)}
        onClose={() => setShowPinned(false)}
        onUnpin={(message) => void onPinMessage(message)}
        top={insets.top + frame.top + 62}
      />

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        {messages.length === 0 ? (
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
          <FlashList
            key={id}
            ref={list}
            data={messages}
            onScrollBeginDrag={() => {
              following.current = false;
            }}
            onContentSizeChange={() => {
              if (following.current) list.current?.scrollToEnd({ animated: false });
            }}
            keyExtractor={(m) => m.id}
            getItemType={(m) => m.content.kind}
            maintainVisibleContentPosition={{
              startRenderingFromBottom: true,
              autoscrollToBottomThreshold: 0.2,
            }}
            ListHeaderComponent={
              <View>
                {messageHistory?.hasOlder ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      messageHistory.error
                        ? `Retry loading earlier messages. ${messageHistory.error}`
                        : 'Load earlier messages'
                    }
                    disabled={messageHistory.loading}
                    onPress={() => void loadOlderMessages(id)}
                    className="items-center px-gutter py-3">
                    <Text
                      variant="caption"
                      className={messageHistory.error ? 'text-danger' : undefined}>
                      {messageHistory.loading
                        ? 'Loading earlier messages…'
                        : messageHistory.error
                          ? `${messageHistory.error} · Retry`
                          : 'Load earlier messages'}
                    </Text>
                  </Pressable>
                ) : null}
                {!isBot && conversation?.protocol ? (
                  <HistoryStatus protocol={conversation.protocol} />
                ) : null}
              </View>
            }
            ListFooterComponent={running ? <CommandPending label={`Running ${running}…`} /> : null}
            contentContainerStyle={{
              paddingTop: insets.top + frame.top + (pinnedMessages.length ? 116 : 62),
              paddingBottom: 8,
            }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
          />
        )}

        <View style={{ paddingBottom: insets.bottom }}>
          {conversation?.consent === 'unknown' ? (
            <ConsentBar conversationId={id} />
          ) : conversation?.kind === 'channel' && conversation.canSend !== true ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={muted ? 'Unmute channel' : 'Mute channel'}
              onPress={() => void setChatPref(id, { muted: !muted })}
              className="mx-gutter mb-2 min-h-tap flex-row items-center justify-center gap-2 rounded-pill border border-line bg-surface-raised">
              <Icon
                name={muted ? 'volume-high-outline' : 'volume-mute-outline'}
                size={18}
                color={colors.brand}
              />
              <Text className="font-semibold text-brand">{muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
          ) : conversation?.canSend === false ? (
            <View className="mx-gutter mb-2 min-h-tap items-center justify-center rounded-pill border border-line bg-surface-raised px-4">
              <Text variant="caption">You cannot send messages in this chat.</Text>
            </View>
          ) : (
            <Composer
              conversationId={id}
              onSendText={(text) => composer.submit(text)}
              onSendContent={onSendContent}
              editing={composer.mode.kind === 'edit'}
              banner={composer.banner(previewOf)}
              onCancelBanner={() => composer.cancel()}
              pendingCommand={pendingCommand}
              onPendingCommandHandled={clearPendingCommand}
              onRunningChange={(command) => {
                setRunning(command);
                if (command) followNewest();
              }}
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
      <ConfirmSheet
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleteCopy.title}
        body={deleteCopy.body}
        busy={remove.busy}
        confirm={{
          label: deleteCopy.label,
          tone: 'danger',
          onPress: async () => {
            if (deleting && (await remove.run(deleting))) setDeleting(null);
          },
        }}
      />
    </View>
  );
}

function MessageRow({
  message,
  previous,
  highlighted,
  replyTarget,
  senderName,
  isGroup,
  previewOf,
  onCommand,
  actions,
  onReact,
  onVote,
}: {
  message: ChatMessage;
  previous: ChatMessage | undefined;
  highlighted: boolean;
  replyTarget: ChatMessage | undefined;
  senderName: string;
  isGroup: boolean;
  previewOf: (target: ChatMessage) => ReplyPreview;
  onCommand: (command: string) => void;
  actions: MessageAction[];
  onReact?: (emoji: string) => void;
  onVote?: (optionIds: number[]) => Promise<void>;
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
      <View className={highlighted ? 'bg-brand/15' : undefined}>
        <MessageBubble
          message={message}
          grouped={grouped && !startsNewDay}
          senderName={senderName}
          showSender={isGroup && !grouped && !message.privateToMe}
          onCommand={onCommand}
          actions={actions}
          replyPreview={
            message.replyTo ? (replyTarget ? previewOf(replyTarget) : MISSING_REPLY) : undefined
          }
          onReact={onReact}
          onVote={onVote}
        />
      </View>
    </>
  );
}
