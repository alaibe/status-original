import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  commandNamePrefix,
  completeCommandName,
  isTypingCommandName,
  parseCommand,
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
  toast,
  useThemeColors,
} from '@/design';
import {
  isLocalConversation,
  STATUS_LOCAL_ID,
  toContent,
} from '@/core/messaging/bots';
import { conversationScope } from '@/core/messaging/conversation-scope';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ConversationId, MessageContent } from '@/core/messaging/types';
import { usePluginHost } from '@/core/plugins/host';
import { errorMessage } from '@/core/errors';
import EmojiPicker from 'rn-emoji-keyboard';

import { GifPicker } from './attachments/gif-picker';
import { pickFile, pickImage, takePhoto } from './attachments/pick';
import { VoiceRecorder } from './attachments/voice-recorder';

export interface ComposerProps {
  conversationId: ConversationId;
  onSendText(text: string): Promise<void>;
  onSendContent?(content: MessageContent): Promise<void>;
  replyTo?: { id: string; preview: string; author: string } | null;
  onCancelReply?(): void;
  pendingCommand?: string | null;
  onRunningChange?: (label: string | null) => void;
  onPendingCommandHandled?(): void;
}

async function respondIn(conversationId: ConversationId, content: MessageContent | string) {
  const body = toContent(content);
  const chat = useChatStore.getState();

  if (isLocalConversation(conversationId)) {
    await chat.postLocalMessage(conversationId, body, 'bot');
    return;
  }

  await chat.postPrivateMessage(conversationId, body);
}

export function Composer({
  conversationId,
  onSendText,
  onSendContent,
  replyTo,
  onCancelReply,
  pendingCommand,
  onRunningChange,
  onPendingCommandHandled,
}: ComposerProps) {
  const colors = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const { registry } = usePluginHost();

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [gifs, setGifs] = useState(false);

  const canAttach = Boolean(onSendContent) && (
    !isLocalConversation(conversationId) ||
    conversationId === STATUS_LOCAL_ID
  );

  const attach = async (pick: () => Promise<MessageContent | null>) => {
    const send = onSendContent;
    if (!send) return;
    try {
      const content = await pick();
      if (content) await send(content);
    } catch (e) {
      setError(errorMessage(e, 'Could not attach that'));
    }
  };

  const kind = useChatStore((s) => s.conversations.find((c) => c.id === conversationId)?.kind);
  const scope = conversationScope(conversationId, kind);

  const commands = useSyncExternalStore(
    registry.subscribe,
    () => registry.commandListFor(conversationId, scope),
    () => registry.commandListFor(conversationId, scope)
  );
  const quickActions = useSyncExternalStore(
    registry.subscribe,
    () => registry.composerActionsFor(conversationId, scope),
    () => registry.composerActionsFor(conversationId, scope)
  );

  const commandNames = commands.flatMap(({ command }) => [command.name, ...(command.aliases ?? [])]);

  const prefix = isTypingCommandName(value) ? commandNamePrefix(value) : null;
  const suggestions =
    prefix === null
      ? []
      : commands.filter(
          ({ command }) =>
            command.name.startsWith(prefix) ||
            command.aliases?.some((alias) => alias.startsWith(prefix))
        );

  const dispatch = useCallback(
    async (raw: string, from: 'typed' | 'action' = 'typed') => {
      const text = raw.trim();
      if (!text) return;
      const respond = (content: MessageContent | string) => respondIn(conversationId, content);

      setError(null);

      // `/draft` and `/reply` are button contracts rather than commands: nobody
      // types them, and `/reply <text>` is the published shape third-party bots
      // build inline keyboards from.
      if (from === 'action') {
        if (text.startsWith('/draft ')) {
          setValue(raw.replace(/^\s*\/draft /, ''));
          return;
        }
        if (text.startsWith('/reply ')) {
          await onSendText(text.slice('/reply '.length));
          return;
        }
      }

      const parsed = commands.length > 0 ? parseCommand(text) : null;

      const entry = parsed
        ? registry.commandsFor(conversationId, scope).get(parsed.name)
        : undefined;

      if (parsed && !entry) {
        const elsewhere = registry.commands().get(parsed.name);
        const home = elsewhere ? registry.get(elsewhere.pluginId)?.manifest.name : undefined;
        setError(
          home
            ? `/${parsed.name} belongs to ${home}. Open that chat to use it.`
            : `Unknown command /${parsed.name}. Type / to see what's available.`
        );
        return;
      }

      const runCommand = async (command: NonNullable<typeof parsed>, found: NonNullable<typeof entry>) => {
        onRunningChange?.(`/${command.name}`);
        const result = await found.command.run({
          rest: command.rest,
          args: command.args,
          conversationId,
          context: found.context,
          respond,
        });
        if (result.type === 'error') await respond(result.message);
        if (result.type === 'notice') toast[result.tone ?? 'info'](result.message);
        setValue(result.type === 'setComposer' ? result.text : '');
      };
      const sendText = async () => {
        await onSendText(text);
        setValue('');
      };

      setBusy(true);
      const work = parsed && entry ? runCommand(parsed, entry) : sendText();
      try {
        await work;
      } catch (e) {
        const message = errorMessage(e, 'Could not send');
        if (entry) await respond(message);
        else setError(message);
      }
      setBusy(false);
      onRunningChange?.(null);
    },
    [registry, conversationId, scope, commands.length, onSendText, onRunningChange]
  );

  const submit = () => {
    if (busy) return;
    return dispatch(value);
  };

  useEffect(() => {
    if (!pendingCommand) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      return dispatch(pendingCommand, 'action').finally(() => {
        if (!cancelled) onPendingCommandHandled?.();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pendingCommand, dispatch, onPendingCommandHandled]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <View>
      {suggestions.length > 0 ? (
        <Animated.View
          entering={Enter.fade()}
          exiting={Exit.fade()}
          className="mx-gutter mb-2 overflow-hidden rounded-card border border-line bg-surface-raised">
          <ScrollView
            testID="command-suggestions"
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            className="max-h-64">
          {suggestions.map(({ command, pluginId }) => (
            <Pressable
              key={command.name}
              testID={`command-${command.name}`}
              accessibilityRole="button"
              onPress={() => {
                setValue(`/${command.name} `);
                inputRef.current?.focus();
              }}
              pressScale={1}
              className="flex-row items-baseline gap-2 border-b border-line px-3 py-2.5 last:border-b-0 active:bg-surface">
              <Text className="font-mono text-footnote font-semibold text-brand">
                /{command.name}
              </Text>
              <Text variant="caption" numberOfLines={1} className="flex-1">
                {command.description}
              </Text>
              <Text variant="micro">{registry.get(pluginId)?.manifest.name ?? ''}</Text>
            </Pressable>
          ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      {error ? (
        <Animated.View entering={Enter.fade()} exiting={Exit.fade()} className="mx-gutter mb-1.5">
          <Text variant="caption" className="text-danger">
            {error}
          </Text>
        </Animated.View>
      ) : null}

      {quickActions.length > 0 && value.length === 0 ? (
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

      {replyTo ? (
        <Animated.View
          entering={Enter.fade()}
          exiting={Exit.fade()}
          className="flex-row items-center gap-2 border-t border-line bg-surface-sunken px-gutter py-2">
          <View className="h-8 w-0.5 rounded-full bg-brand" />
          <View className="min-w-0 flex-1">
            <Text variant="micro" className="font-semibold text-brand">
              {replyTo.author}
            </Text>
            <Text variant="caption" numberOfLines={1}>
              {replyTo.preview}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
            className="h-tap w-tap items-center justify-center">
            <Icon name="close" size={18} color={colors['content-subtle']} />
          </Pressable>
        </Animated.View>
      ) : null}

      <Animated.View
        layout={springLayout()}
        className="flex-row items-end gap-2 px-3 pb-2 pt-1">
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
        {/* Controlled: typing a slash command rewrites the text with its completion. */}
        <TextInput
          testID="composer-input"
          ref={inputRef}
          value={value}
          onChangeText={(t) => {
            if (t.includes('\t')) {
              const typed = t.replace(/\t/g, '');
              setValue(completeCommandName(typed, commandNames) ?? typed);
              if (error) setError(null);
              return;
            }
            setValue(t);
            if (error) setError(null);
          }}
          placeholder="Message"
          placeholderTextColor={colors['content-subtle']}
          multiline
          className="max-h-32 min-h-[42px] flex-1 py-2.5 pr-1 text-body text-content"
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
        />

        <Pressable
          testID="composer-emoji"
          accessibilityRole="button"
          accessibilityLabel="Emoji"
          onPress={() => setEmoji(true)}
          className="h-11 w-9 items-center justify-center">
          <Icon name="happy-outline" size={21} color={colors['content-muted']} />
        </Pressable>
        </View>

        {canAttach && value.trim().length === 0 && !busy ? (
          <VoiceRecorder
            onRecorded={(content) => {
              onSendContent?.(content).catch((e) =>
                setError(errorMessage(e, 'Could not send that'))
              );
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

      <GifPicker
        visible={gifs}
        onClose={() => setGifs(false)}
        onPick={(content) => {
          onSendContent?.(content).catch((e) =>
            setError(errorMessage(e, 'Could not send that GIF'))
          );
        }}
      />

      <EmojiPicker
        open={emoji}
        onClose={() => setEmoji(false)}
        onEmojiSelected={(picked) => setValue((current) => current + picked.emoji)}
        enableSearchBar
        categoryPosition="top"
      />

      <ActionSheet
        visible={attaching}
        onClose={() => setAttaching(false)}
        title="Attach"
        actions={[
          { label: 'Photo library', onPress: () => attach(pickImage) },
          { label: 'Take a photo', onPress: () => attach(takePhoto) },
          { label: 'File', onPress: () => attach(pickFile) },
          { label: 'GIF', onPress: () => setGifs(true) },
        ]}
      />
    </View>
  );
}
