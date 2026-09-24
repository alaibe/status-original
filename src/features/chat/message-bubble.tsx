import { useRef, useState } from 'react';
import { Pressable as RNPressable, View } from 'react-native';

import { cn, Icon, Text, useThemeColors } from '@/design';
import { usePluginHost } from '@/core/plugins/host';
import type { ChatMessage, WidgetContent } from '@/core/messaging/types';
import { MessageActions, type MessageAction, type MessageAnchor } from './message-actions';
import { findTransactionHash } from '@/lib/evm/transactions';
import { segmentText, type LinkSegment } from '@/core/messaging/links';
import { labelledLinks, plainText } from '@/core/messaging/markdown';
import { parseLocation } from '@/core/messaging/locations';
import { AddressPreview } from './address-preview';
import { LinkPreviewCard } from './link-preview-card';
import { LocationCard } from './location-card';
import { MessageText } from './message-text';
import { TransactionPreview } from './transaction-preview';
import { WidgetView } from '@/design/widgets/widget-view';
import { useLiveWidget } from './use-live-widget';
import { FileBubble } from './attachments/file-bubble';
import { ImageBubble } from './attachments/image-bubble';
import { VoiceBubble } from './attachments/voice-bubble';
import { VideoBubble } from './attachments/video-bubble';
import { PollBubble } from './poll-bubble';
import { formatTimestamp } from '@/core/messaging/preview';
import { openInBrowser } from '@/lib/open-url';

export interface ReplyPreview {
  author: string;
  preview: string;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  grouped: boolean;
  senderName: string;
  showSender: boolean;
  onCommand?: (command: string) => void;
  onReact?: (emoji: string) => void;
  onVote?: (optionIds: number[]) => Promise<void>;
  actions: MessageAction[];
  replyPreview?: ReplyPreview;
  thread?: ThreadChip;
}

export interface ThreadChip {
  replies: number;
  onOpen(): void;
}

export function MessageBubble({
  message,
  grouped,
  senderName,
  showSender,
  onCommand,
  onReact,
  onVote,
  actions,
  replyPreview,
  thread,
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
        children = (
          <TextBody message={message} text={content.fallback ?? 'Rich message'} unsupported />
        );
      }
      break;
    }

    case 'image':
    case 'video': {
      const media =
        content.kind === 'image' ? (
          <ImageBubble
            uri={content.uri}
            width={content.width}
            height={content.height}
            caption={content.caption}
            fromMe={fromMe}
          />
        ) : (
          <VideoBubble
            uri={content.uri}
            width={content.width}
            height={content.height}
            caption={content.caption}
            gif={content.gif}
            fromMe={fromMe}
          />
        );
      bare = !content.caption && !replyPreview;
      children = bare ? (
        <View>
          {media}
          <Footer message={message} overlay />
        </View>
      ) : (
        <>
          {media}
          <Footer message={message} />
        </>
      );
      break;
    }

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

    case 'poll':
      children = (
        <>
          <PollBubble poll={content} fromMe={fromMe} onVote={onVote} />
          <Footer message={message} />
        </>
      );
      break;

    case 'text':
      children = <TextBody message={message} text={content.text} onCommand={onCommand} />;
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
      actions={actions}
      replyPreview={replyPreview}
      thread={thread}
      bare={bare}>
      {children}
    </BubbleShell>
  );
}

function TextBody({
  message,
  text,
  unsupported = false,
  onCommand,
}: {
  message: ChatMessage;
  text: string;
  unsupported?: boolean;
  onCommand?: (command: string) => void;
}) {
  const { fromMe } = message;
  const className = cn('text-body', fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on');

  if (unsupported) {
    return (
      <>
        <Text className={cn(className, 'italic opacity-80')}>{text}</Text>
        <Footer message={message} />
      </>
    );
  }

  const plain = plainText(text);
  const segments = segmentText(plain);
  const transactionHash = findTransactionHash(plain);
  const link =
    segments.find((s): s is LinkSegment => s.kind === 'url' || s.kind === 'location') ??
    labelledLinks(text).map((href): LinkSegment => ({ kind: 'url', text: href, href }))[0];
  const location = link ? parseLocation(link.href) : null;
  const account = segments.find((s) => s.kind === 'address' || s.kind === 'ens');

  return (
    <>
      <MessageText
        text={text}
        fromMe={fromMe}
        className={className}
        conversationId={message.conversationId}
        onCommand={onCommand}
      />

      {transactionHash ? <TransactionPreview hash={transactionHash} fromMe={fromMe} /> : null}
      {location ? (
        <LocationCard location={location} fromMe={fromMe} />
      ) : link?.kind === 'url' ? (
        <LinkPreviewCard url={link.href} fromMe={fromMe} />
      ) : null}
      {account ? (
        <AddressPreview
          value={account.text}
          conversationId={message.conversationId}
          onCommand={onCommand}
        />
      ) : null}

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
  actions,
  replyPreview,
  thread,
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
  actions: MessageAction[];
  replyPreview?: ReplyPreview;
  thread?: ThreadChip;
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

  const bubble = (held: boolean) => (
    <View
      className={cn(
        'px-gutter',
        grouped ? 'pt-0.5' : 'pt-2',
        fromMe ? 'items-end' : 'items-start'
      )}>
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

      {!held && thread ? (
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={`Open thread, ${repliesLabel(thread.replies)}`}
          onPress={thread.onOpen}
          className="mt-1 flex-row items-center gap-1 rounded-pill bg-surface-sunken px-2.5 py-1">
          <Icon name="chatbubbles-outline" size={13} color={colors.brand} />
          <Text variant="caption" className="font-semibold text-brand">
            {repliesLabel(thread.replies)}
          </Text>
          <Icon name="chevron-forward" size={12} color={colors.brand} />
        </RNPressable>
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

/** `overlay` sits the time on a photo that has no bubble around it. */
function Footer({ message, overlay = false }: { message: ChatMessage; overlay?: boolean }) {
  const colors = useThemeColors();
  const tint = overlay
    ? '#fff'
    : message.fromMe
      ? colors['bubble-out-on']
      : colors['content-subtle'];

  return (
    <View
      className={cn(
        'flex-row items-center justify-end gap-1',
        overlay ? 'absolute bottom-1.5 right-1.5 rounded-pill bg-black/45 px-1.5 py-0.5' : '-mt-0.5'
      )}>
      <Text
        variant="micro"
        className={
          overlay ? 'text-white' : message.fromMe ? 'text-bubble-out-on/70' : 'text-content-subtle'
        }>
        {`${message.edited ? 'edited ' : ''}${formatTimestamp(message.sentAt)}`}
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
          color={message.status === 'failed' ? colors.danger : message.readAt ? colors.brand : tint}
        />
      ) : null}
    </View>
  );
}

function repliesLabel(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`;
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
