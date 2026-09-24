import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  commandNamePrefix,
  completeCommandName,
  isTypingCommandName,
} from '@/core/commands/parser';
import {
  ActionSheet,
  cn,
  Enter,
  Exit,
  Icon,
  Pressable,
  springLayout,
  Text,
  useThemeColors,
} from '@/design';
import { isLocalConversation, SAVED_LOCAL_ID, STATUS_LOCAL_ID } from '@/core/messaging/bots';
import { conversationScope } from '@/core/messaging/conversation-scope';
import { useChatStore } from '@/core/messaging/chat-store';
import { draftKey } from '@/core/messaging/drafts';
import type { ConversationId, MessageContent, MessageId } from '@/core/messaging/types';
import { usePluginHost } from '@/core/plugins/host';
import { errorMessage } from '@/core/errors';

import { MediaPanel, type MediaAnchor } from './media-panel';
import type { MediaTab } from './media-panel-content';
import {
  contentFromBrowserFile,
  pickFile,
  pickImage,
  pickVideo,
  takePhoto,
} from './attachments/pick';
import { VoiceRecorder } from './attachments/voice-recorder';
import { ComposerInput, type ComposerInputHandle } from './composer-input';
import type { ComposerBanner } from './composer-mode';
import { SuggestionPopover } from './suggestion-popover';
import { useCommandDispatch } from './use-command-dispatch';
import { useMentionSuggestions } from './use-mention-suggestions';
import { useSupports } from './use-supports';
import { useTypingAnnouncer } from './use-typing-announcer';

export interface ComposerProps {
  conversationId: ConversationId;
  /** Writes into this thread, with a draft of its own. */
  thread?: MessageId;
  onSendText(text: string): Promise<string>;
  onSendContent(content: MessageContent): Promise<void>;
  /** Editing hides attachments and mentions: only the text of a message can change. */
  editing?: boolean;
  banner?: ComposerBanner | null;
  onCancelBanner(): void;
  pendingCommand: string | null;
  onRunningChange(label: string | null): void;
  onPendingCommandHandled(): void;
}

export function Composer({
  conversationId,
  thread,
  onSendText,
  onSendContent,
  editing = false,
  banner,
  onCancelBanner,
  pendingCommand,
  onRunningChange,
  onPendingCommandHandled,
}: ComposerProps) {
  const colors = useThemeColors();
  const inputRef = useRef<ComposerInputHandle>(null);
  const { registry } = usePluginHost();
  const { supports, sendsVideo } = useSupports(conversationId);

  const value = useChatStore((s) => s.drafts[draftKey(conversationId, thread)] ?? '');
  const setDraftFor = useChatStore((s) => s.setDraft);
  const setValue = useCallback(
    (text: string) => setDraftFor(conversationId, text, thread),
    [conversationId, thread, setDraftFor]
  );

  const kind = useChatStore((s) => s.conversations.find((c) => c.id === conversationId)?.kind);
  const scope = conversationScope(conversationId, kind);
  const { commands, dispatch, busy, error, setError } = useCommandDispatch({
    conversationId,
    scope,
    onSendText,
    setDraft: setValue,
    onRunningChange,
    pendingCommand,
    onPendingCommandHandled,
  });
  const announceTyping = useTypingAnnouncer(conversationId, supports('setTyping'));
  const mentions = useMentionSuggestions(
    conversationId,
    value,
    !editing && kind === 'group' && supports('mentionCandidates')
  );
  const quickActions = useSyncExternalStore(
    registry.subscribe,
    () => registry.composerActionsFor(conversationId, scope),
    () => registry.composerActionsFor(conversationId, scope)
  );

  const [attaching, setAttaching] = useState(false);
  const [media, setMedia] = useState<{ tab: MediaTab; anchor: MediaAnchor | null } | null>(null);
  const emojiButton = useRef<View>(null);
  const openMedia = (tab: MediaTab) => {
    const button = emojiButton.current;
    if (!button) return setMedia({ tab, anchor: null });
    button.measureInWindow((x, y, width, height) =>
      setMedia({ tab, anchor: { x, y, width, height } })
    );
  };

  const canAttach =
    !editing &&
    (!isLocalConversation(conversationId) ||
      conversationId === STATUS_LOCAL_ID ||
      conversationId === SAVED_LOCAL_ID);

  const attach = async (pick: () => Promise<MessageContent | null>) => {
    try {
      const content = await pick();
      if (content) await onSendContent(content);
    } catch (e) {
      setError(errorMessage(e, 'Could not attach that'));
    }
  };

  const commandNames = commands.flatMap(({ command }) => [
    command.name,
    ...(command.aliases ?? []),
  ]);
  const prefix = isTypingCommandName(value) ? commandNamePrefix(value) : null;
  const suggestions =
    prefix === null
      ? []
      : commands.filter(
          ({ command }) =>
            command.name.startsWith(prefix) ||
            command.aliases?.some((alias) => alias.startsWith(prefix))
        );

  const fill = (text: string) => {
    setValue(text);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (busy) return;
    return dispatch(value);
  };

  useEffect(() => {
    if (process.env.EXPO_OS === 'web') inputRef.current?.focus();
  }, [conversationId, thread]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <View>
      <SuggestionPopover
        items={mentions.matches}
        keyOf={(person) => person.id}
        labelOf={(person) => `Mention ${person.name}`}
        onPick={(person) => fill(mentions.apply(person))}
        render={(person) => (
          <>
            <Text className="flex-1 font-semibold">{person.name}</Text>
            <Text variant="caption">{person.handle}</Text>
          </>
        )}
      />
      <SuggestionPopover
        testID="command-suggestions"
        items={suggestions}
        keyOf={({ command }) => command.name}
        itemTestID={({ command }) => `command-${command.name}`}
        onPick={({ command }) => fill(`/${command.name} `)}
        render={({ command, pluginId }) => (
          <>
            <Text className="font-mono text-footnote font-semibold text-brand">
              /{command.name}
            </Text>
            <Text variant="caption" numberOfLines={1} className="flex-1">
              {command.description}
            </Text>
            <Text variant="micro">{registry.get(pluginId)?.manifest.name ?? ''}</Text>
          </>
        )}
      />

      {error ? (
        <Animated.View entering={Enter.fade()} exiting={Exit.fade()} className="mx-gutter mb-1.5">
          <Text variant="caption" className="text-danger">
            {error}
          </Text>
        </Animated.View>
      ) : null}

      {quickActions.length > 0 ? (
        <Animated.View entering={Enter.fade()} exiting={Exit.fade()}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-2 px-gutter pb-2">
            {quickActions.map(({ action }) => (
              <Pressable
                key={action.id}
                testID={`quick-${action.id}`}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => dispatch(action.command, 'action')}
                className="flex-row items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-3 py-1.5">
                <Icon name={action.icon} size={14} color={colors.brand} />
                <Text variant="caption" className="font-medium text-content">
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      {banner ? (
        <Animated.View
          entering={Enter.fade()}
          exiting={Exit.fade()}
          className="flex-row items-center gap-2 border-t border-line bg-surface-sunken px-gutter py-2">
          <View className="h-8 w-0.5 rounded-full bg-brand" />
          <View className="min-w-0 flex-1">
            <Text
              variant={banner.detail ? 'micro' : 'caption'}
              className="font-semibold text-brand">
              {banner.label}
            </Text>
            {banner.detail ? (
              <Text variant="caption" numberOfLines={1}>
                {banner.detail}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Cancel edit' : 'Cancel reply'}
            onPress={onCancelBanner}
            className="h-tap w-tap items-center justify-center">
            <Icon name="close" size={18} color={colors['content-subtle']} />
          </Pressable>
        </Animated.View>
      ) : null}

      <Animated.View layout={springLayout()} className="flex-row items-end gap-2 px-3 pb-2 pt-1">
        {canAttach ? (
          <Pressable
            testID="composer-attach"
            accessibilityRole="button"
            accessibilityLabel="Attach"
            onPress={() => setAttaching(true)}
            className="h-11 w-11 items-center justify-center rounded-pill border border-line bg-surface-raised">
            <Icon name="attach-outline" size={20} color={colors['content-muted']} />
          </Pressable>
        ) : null}

        <View className="min-h-[44px] flex-1 flex-row items-end rounded-pill border border-line bg-surface-raised pl-4 pr-1">
          <ComposerInput
            ref={inputRef}
            value={value}
            onChangeText={(text) => {
              announceTyping(text);
              if (error) setError(null);
              const typed = text.replace(/\t/g, '');
              setValue(typed === text ? text : (completeCommandName(typed, commandNames) ?? typed));
            }}
            onSubmit={() => void submit()}
            onFile={
              canAttach
                ? (file) => void attach(() => contentFromBrowserFile(file, sendsVideo))
                : undefined
            }
            placeholder={thread ? 'Reply in thread' : 'Message'}
            placeholderColor={colors['content-subtle']}
          />

          <View ref={emojiButton} collapsable={false}>
            <Pressable
              testID="composer-emoji"
              accessibilityRole="button"
              accessibilityLabel="Emoji"
              onPress={() => openMedia('emoji')}
              className="h-11 w-9 items-center justify-center">
              <Icon name="happy-outline" size={21} color={colors['content-muted']} />
            </Pressable>
          </View>
        </View>

        {canAttach && value.trim().length === 0 && !busy ? (
          <VoiceRecorder
            onRecorded={(content) => {
              onSendContent(content).catch((e) => setError(errorMessage(e, 'Could not send that')));
            }}
            onError={setError}
          />
        ) : (
          <Pressable
            testID="composer-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!canSend}
            onPress={submit}
            className={cn(
              'h-11 w-11 items-center justify-center rounded-pill',
              canSend ? 'bg-brand' : 'border border-line bg-surface-raised'
            )}>
            <Icon
              name={busy ? 'ellipsis-horizontal' : 'arrow-up'}
              size={20}
              color={canSend ? colors['brand-on'] : colors['content-subtle']}
            />
          </Pressable>
        )}
      </Animated.View>

      {media ? (
        <MediaPanel
          tab={media.tab}
          anchor={media.anchor}
          onClose={() => {
            setMedia(null);
            // After the modal has unmounted, or its focus trap puts the focus back on the button.
            if (process.env.EXPO_OS === 'web') setTimeout(() => inputRef.current?.focus(), 0);
          }}
          onEmoji={(picked) => setValue(value + picked)}
          onGif={(content) => {
            onSendContent(content).catch((e) =>
              setError(errorMessage(e, 'Could not send that GIF'))
            );
          }}
        />
      ) : null}

      <ActionSheet
        visible={attaching}
        onClose={() => setAttaching(false)}
        title="Attach"
        actions={[
          { label: 'Photo library', icon: 'images-outline', onPress: () => attach(pickImage) },
          ...(sendsVideo
            ? [
                {
                  label: 'Video',
                  icon: 'videocam-outline' as const,
                  onPress: () => attach(pickVideo),
                },
              ]
            : []),
          { label: 'Take a photo', icon: 'camera-outline', onPress: () => attach(takePhoto) },
          { label: 'File', icon: 'document-outline', onPress: () => attach(pickFile) },
          { label: 'GIF', icon: 'happy-outline', onPress: () => openMedia('gifs') },
        ]}
      />
    </View>
  );
}
