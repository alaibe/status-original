import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChatBackground,
  ConfirmSheet,
  EmptyState,
  Icon,
  Pressable,
  Text,
  toast,
  useEscapeKey,
  useLayoutInsets,
  useThemeColors,
} from '@/design';
import { isLocalConversation } from '@/core/messaging/bots';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type {
  ChatMessage,
  ConversationId,
  MessageContent,
  MessageId,
} from '@/core/messaging/types';
import { useAppearanceStore } from '@/core/app/appearance';
import { contentPreview, isNewDay } from '@/core/messaging/preview';
import { errorMessage } from '@/core/errors';
import { Composer } from './composer';
import { ConsentBar } from './consent-bar';
import { DateSeparator } from './date-separator';
import { CommandPending } from './command-pending';
import { ForwardSheet } from './forward-sheet';
import { MessageBubble, type ReplyPreview, type ThreadChip } from './message-bubble';
import { conversationPeers, conversationTitle } from '@/core/messaging/display-names';
import { useDisplayNames } from './use-display-names';
import { useSupports } from './use-supports';
import { useComposerMode } from './composer-mode';
import { useAction } from './use-action';
import { usePinnedMessages } from './use-pinned-messages';
import type { MessageAction } from './message-actions';
import { type ActionSupport, type ConversationActions, messageActions } from './message-commands';
import { HistoryStatus } from './history-status';
import { useConversationTimeline } from './use-conversation-timeline';
import { PinnedMessages } from './pinned-messages';
import { ConversationHeader } from './conversation-header';

const GROUP_WINDOW_MS = 60_000;

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

export interface ConversationViewProps {
  id: ConversationId;
  /** Shows this thread: the message that started it and the replies to it. */
  thread?: MessageId;
  onOpenThread?(root: MessageId): void;
  onBack(): void;
}

export function ConversationView({ id, thread, onOpenThread, onBack }: ConversationViewProps) {
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  // On desktop the frame draws the wallpaper and the sidebar does the navigating.
  const desktop = process.env.EXPO_OS === 'web';
  useEscapeKey(Boolean(thread), onBack);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const frame = useLayoutInsets();

  const sessions = useChatStore((s) => s.sessions);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const fetchingHistory = useChatStore(
    (s) =>
      !!conversation?.protocol && s.protocols[conversation.protocol]?.history?.status === 'fetching'
  );
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const react = useChatStore((s) => s.react);
  const votePoll = useChatStore((s) => s.votePoll);
  const setMessagePinned = useChatStore((s) => s.setMessagePinned);
  const ingestMessage = useChatStore((s) => s.ingestMessage);
  const muted = useChatStore((s) => Boolean(s.chatPrefs[id]?.muted));
  const setChatPref = useChatStore((s) => s.setChatPref);

  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<{ message: ChatMessage; forEveryone: boolean } | null>(
    null
  );
  const [showPinned, setShowPinned] = useState(false);

  const selfId = selfIdFor({ sessions }, conversation?.protocol);

  const isBot = isLocalConversation(id);

  const peers = conversation ? conversationPeers(conversation, selfId) : [];
  const { nameFor } = useDisplayNames(peers);

  const { session, supports, threads } = useSupports(id);
  const {
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
  } = useConversationTimeline(id, thread, conversation, session, Boolean(onOpenThread));
  const pinnedMessages = usePinnedMessages(
    id,
    allMessages,
    !thread && supports('listPinnedMessages')
  );
  const deleteCopy = DELETE_COPY[deleting?.forEveryone ? 'everyone' : 'me'];
  const remove = useAction(
    ({ message, forEveryone }: { message: ChatMessage; forEveryone: boolean }) =>
      deleteMessage(id, message.id, forEveryone),
    {
      failure: 'Could not delete message',
    }
  );
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const runCommand = (command: string) => setPendingCommand(command);
  const clearPendingCommand = () => setPendingCommand(null);

  const onSendContent = async (content: MessageContent) => {
    followNewest();
    await sendMessage(id, content, undefined, thread);
  };

  const previewOf = (target: ChatMessage): ReplyPreview => ({
    author: target.fromMe ? 'You' : nameFor(target.senderId),
    preview: contentPreview(target.content) || 'Message',
  });

  const composer = useComposerMode(id, followNewest, thread);

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
    openThread: (message) => onOpenThread?.(message.threadRoot ?? message.id),
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
    thread: threads && onOpenThread !== undefined,
  };
  const canVote = supports('votePoll');

  const renderItem = ({ item, index }: ListRenderItemInfo<ChatMessage>) => {
    const previous = messages[index - 1];
    const replies = replyCounts.get(item.id) ?? 0;
    const target = item.replyTo ? byId.get(item.replyTo) : undefined;
    return (
      <MessageRow
        message={item}
        previous={previous}
        highlighted={item.id === highlighted}
        replyPreview={item.replyTo ? (target ? previewOf(target) : MISSING_REPLY) : undefined}
        senderName={isBot ? botName : nameFor(item.senderId)}
        isGroup={isGroup}
        onCommand={runCommand}
        actions={messageActions(item, handlers, can)}
        onReact={item.privateToMe ? undefined : (emoji) => onReactTo(item.id, emoji)}
        onVote={canVote ? (optionIds) => votePoll(id, item.id, optionIds) : undefined}
        thread={
          replies > 0 && onOpenThread ? { replies, onOpen: () => onOpenThread(item.id) } : undefined
        }
      />
    );
  };

  const chatTitle = conversation
    ? conversationTitle(conversation, selfId, nameFor)
    : 'Conversation';

  return (
    <View className={desktop ? 'flex-1' : 'flex-1 bg-canvas'}>
      {desktop ? null : <ChatBackground pattern={wallpaper} />}

      <ConversationHeader
        id={id}
        thread={thread}
        conversation={conversation}
        selfId={selfId}
        chatTitle={chatTitle}
        onBack={onBack}
      />

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
            onScrollBeginDrag={pauseFollowing}
            onContentSizeChange={followIfNeeded}
            keyExtractor={(m) => m.id}
            getItemType={(m) => m.content.kind}
            maintainVisibleContentPosition={{
              startRenderingFromBottom: true,
              autoscrollToBottomThreshold: 0.2,
            }}
            ListHeaderComponent={
              <View>
                {!thread && messageHistory?.hasOlder ? (
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
              thread={thread}
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
  replyPreview,
  senderName,
  isGroup,
  onCommand,
  actions,
  onReact,
  onVote,
  thread,
}: {
  message: ChatMessage;
  previous: ChatMessage | undefined;
  highlighted: boolean;
  replyPreview: ReplyPreview | undefined;
  senderName: string;
  isGroup: boolean;
  onCommand: (command: string) => void;
  actions: MessageAction[];
  onReact?: (emoji: string) => void;
  onVote?: (optionIds: number[]) => Promise<void>;
  thread?: ThreadChip;
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
          replyPreview={replyPreview}
          onReact={onReact}
          onVote={onVote}
          thread={thread}
        />
      </View>
    </>
  );
}
