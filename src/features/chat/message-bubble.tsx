import { useRef, useState } from 'react';
import { Pressable as RNPressable, View } from 'react-native';

import * as Clipboard from 'expo-clipboard';


import { cn, Icon, Text, toast, useThemeColors } from '@/design';
import { usePluginHost } from '@/core/plugins/host';
import type { ChatMessage, WidgetContent } from '@/core/messaging/types';
import { MessageActions, type MessageAction, type MessageAnchor } from './message-actions';
import { findTransactionHash } from '@/lib/evm/transactions';
import { TransactionPreview } from './transaction-preview';
import { WidgetView } from '@/design/widgets/widget-view';
import { useLiveWidget } from './use-live-widget';
import { FileBubble } from './attachments/file-bubble';
import { ImageBubble } from './attachments/image-bubble';
import { VoiceBubble } from './attachments/voice-bubble';
import { formatTimestamp } from '@/core/messaging/preview';
import { openInBrowser } from '@/lib/open-url';

export interface MessageBubbleProps {
  message: ChatMessage;
  grouped: boolean;
  senderName: string;
  showSender: boolean;
  onCommand?: (command: string) => void;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onForward?: () => void;
  onRetry?: () => void;
  replyPreview?: { author: string; preview: string };
}

export function MessageBubble({
  message,
  grouped,
  senderName,
  showSender,
  onCommand,
  onReact,
  onReply,
  onForward,
  onRetry,
  replyPreview,
}: MessageBubbleProps) {
  const { registry } = usePluginHost();

  const { fromMe, content } = message;

  if (content.kind === 'system') {
    return (
      <View className="items-center py-2">
        <View className="rounded-pill bg-surface-sunken px-3 py-1">
          <Text variant="caption">{content.text}</Text>
        </View>
      </View>
    );
  }

  if (content.kind === 'reaction') return null;

  let bare = false;
  let children: React.ReactNode;

  switch (content.kind) {
    case 'widget':
      bare = true;
      children = content.live ? (
        <LiveWidget content={content} onCommand={onCommand} />
      ) : (
        <WidgetView widget={content.widget} onCommand={onCommand} onOpenUrl={openUrl} />
      );
      break;

    case 'custom': {
      const entry = registry.contentTypes().get(content.typeId);
      if (entry) {
        const Renderer = entry.spec.render;
        bare = true;
        children = (
          <Renderer
            data={content.data}
            message={message}
            fromMe={fromMe}
            context={entry.context}
            onCommand={onCommand}
          />
        );
      } else {
        children = <TextBody message={message} text={content.fallback ?? 'Rich message'} unsupported />;
      }
      break;
    }

    case 'image':
      children = (
        <>
          <ImageBubble
            uri={content.uri}
            width={content.width}
            height={content.height}
            caption={content.caption}
            fromMe={fromMe}
          />
          <Footer message={message} />
        </>
      );
      break;

    case 'file':
      children = (
        <>
          <FileBubble
            uri={content.uri}
            name={content.name}
            mimeType={content.mimeType}
            size={content.size}
            fromMe={fromMe}
          />
          <Footer message={message} />
        </>
      );
      break;

    case 'voice':
      children = (
        <>
          <VoiceBubble
            uri={content.uri}
            durationMs={content.durationMs}
            fromMe={fromMe}
            seed={message.id}
          />
          <Footer message={message} />
        </>
      );
      break;

    case 'text':
      children = <TextBody message={message} text={content.text} />;
      break;

    default:
      children = <TextBody message={message} text={content.fallback} unsupported />;
  }

  return (
    <BubbleShell
      fromMe={fromMe}
      grouped={grouped}
      senderName={senderName}
      showSender={showSender}
      reactions={message.reactions}
      privateToMe={message.privateToMe}
      onReact={onReact}
      onReply={onReply}
      onForward={onForward}
      onRetry={onRetry}
      copyText={copyableText(content)}
      replyPreview={replyPreview}
      bare={bare}>
      {children}
    </BubbleShell>
  );
}

function TextBody({
  message,
  text,
  unsupported = false,
}: {
  message: ChatMessage;
  text: string;
  unsupported?: boolean;
}) {
  const { fromMe } = message;
  const transactionHash = unsupported ? null : findTransactionHash(text);

  return (
    <>
      <Text
        className={cn(
          'text-body',
          fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on',
          unsupported && 'italic opacity-80'
        )}>
        {text}
      </Text>

      {transactionHash ? <TransactionPreview hash={transactionHash} fromMe={fromMe} /> : null}

      <Footer message={message} />
    </>
  );
}

function BubbleShell({
  fromMe,
  grouped,
  senderName,
  showSender,
  bare = false,
  privateToMe = false,
  reactions,
  onReact,
  onReply,
  onForward,
  onRetry,
  copyText,
  replyPreview,
  children,
}: {
  fromMe: boolean;
  grouped: boolean;
  senderName: string;
  showSender: boolean;
  bare?: boolean;
  privateToMe?: boolean;
  reactions?: Record<string, string[]>;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onForward?: () => void;
  onRetry?: () => void;
  copyText?: string;
  replyPreview?: { author: string; preview: string };
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const [picking, setPicking] = useState(false);
  const [anchor, setAnchor] = useState<MessageAnchor | null>(null);
  const bubbleRef = useRef<View>(null);

  const open = () => {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setPicking(true);
    });
  };

  const actions: MessageAction[] = [];
  if (onRetry) {
    actions.push({ id: 'retry', label: 'Try again', icon: 'refresh-outline', onPress: onRetry });
  }
  if (onReply) {
    actions.push({ id: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: onReply });
  }
  if (copyText) {
    actions.push({
      id: 'copy',
      label: 'Copy',
      icon: 'copy-outline',
      onPress: () => {
        Clipboard.setStringAsync(copyText)
          .then(() => toast.success('Copied'))
          .catch(() => toast.error('Could not copy'));
      },
    });
  }
  if (onForward) {
    actions.push({
      id: 'forward',
      label: 'Forward',
      icon: 'arrow-redo-outline',
      onPress: onForward,
    });
  }

  const bubble = (held: boolean) => (
    <View
      className={cn('px-gutter', grouped ? 'pt-0.5' : 'pt-2', fromMe ? 'items-end' : 'items-start')}>
      {showSender && !fromMe ? (
        <Text variant="micro" className="mb-0.5 ml-3 font-medium">
          {senderName}
        </Text>
      ) : null}

      <RNPressable
        ref={held ? undefined : bubbleRef}
        onLongPress={held || actions.length === 0 ? undefined : open}
        // The desktop counterpart of the long-press. Spelled out rather than
        // through `contextMenu()`: react-hooks/refs treats passing `open` to a
        // call made during render as a ref read during render.
        {...(process.env.EXPO_OS === 'web' && !held && actions.length > 0
          ? {
              onContextMenu: (event: { preventDefault(): void }) => {
                event.preventDefault();
                open();
              },
            }
          : undefined)}
        delayLongPress={280}
        accessible={false}
        className={cn(
          // A wide window would otherwise stretch a bubble across the pane.
          process.env.EXPO_OS === 'web' ? 'max-w-[min(82%,560px)]' : 'max-w-[82%]',
          bare
            ? ''
            : cn(
                'rounded-bubble px-3.5 py-2',
                fromMe ? 'bg-bubble-out' : 'bg-bubble-in',
                fromMe ? 'rounded-br-md' : 'rounded-bl-md',
                grouped && (fromMe ? 'rounded-tr-md' : 'rounded-tl-md')
              )
        )}>
        {replyPreview ? (
          <View
            className={cn(
              'mb-1.5 flex-row gap-2 rounded-md px-2 py-1',
              fromMe ? 'bg-bubble-out-on/15' : 'bg-content/5'
            )}>
            <View className={cn('w-0.5 rounded-full', fromMe ? 'bg-bubble-out-on' : 'bg-brand')} />
            <View className="min-w-0 flex-1">
              {replyPreview.author ? (
                <Text
                  variant="micro"
                  className={cn('font-semibold', fromMe ? 'text-bubble-out-on' : 'text-brand')}>
                  {replyPreview.author}
                </Text>
              ) : null}
              <Text
                variant="caption"
                numberOfLines={1}
                className={fromMe ? 'text-bubble-out-on/80' : undefined}>
                {replyPreview.preview}
              </Text>
            </View>
          </View>
        ) : null}
        {children}
      </RNPressable>

      {privateToMe ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Icon name="eye-off-outline" size={11} color={colors['content-subtle']} />
          <Text variant="micro">Only you can see this</Text>
        </View>
      ) : null}

      {!held && reactions && Object.keys(reactions).length > 0 ? (
        <View className={cn('mt-1 flex-row flex-wrap gap-1', fromMe && 'justify-end')}>
          {Object.entries(reactions).map(([emoji, people]) => (
            <RNPressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              onPress={() => onReact?.(emoji)}
              className="flex-row items-center gap-1 rounded-pill bg-surface-sunken px-2 py-0.5">
              <Text variant="caption">{emoji}</Text>
              {people.length > 1 ? (
                <Text variant="micro" className="tabular-nums">
                  {people.length}
                </Text>
              ) : null}
            </RNPressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      {bubble(false)}

      <MessageActions
        visible={picking}
        anchor={anchor}
        fromMe={fromMe}
        actions={actions}
        onReact={onReact}
        onClose={() => setPicking(false)}
        render={() => bubble(true)}
      />
    </>
  );
}

function Footer({ message }: { message: ChatMessage }) {
  const colors = useThemeColors();
  const tint = message.fromMe ? colors['bubble-out-on'] : colors['content-subtle'];

  return (
    <View className="-mt-0.5 flex-row items-center justify-end gap-1">
      <Text
        variant="micro"
        className={message.fromMe ? 'text-bubble-out-on/70' : 'text-content-subtle'}>
        {formatTimestamp(message.sentAt)}
      </Text>
      {message.fromMe ? (
        <Icon
          name={
            message.status === 'failed'
              ? 'alert-circle'
              : message.status === 'sending'
                ? 'time-outline'
                : 'checkmark-done'
          }
          size={13}
          color={
            message.status === 'failed'
              ? colors.danger
              :
                message.readAt
                ? colors.brand
                : tint
          }
        />
      ) : null}
    </View>
  );
}

function copyableText(content: ChatMessage['content']): string | undefined {
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'system':
      return content.text;
    case 'image':
      return content.caption || undefined;
    case 'file':
      return content.name;
    case 'custom':
      return content.fallback || undefined;
    case 'widget':
      return content.fallback || undefined;
    default:
      return undefined;
  }
}

const openUrl = (url: string) => {
  openInBrowser(url).catch(() => {});
};

function LiveWidget({
  content,
  onCommand,
}: {
  content: WidgetContent;
  onCommand?: (command: string) => void;
}) {
  return <WidgetView widget={useLiveWidget(content)} onCommand={onCommand} onOpenUrl={openUrl} />;
}
