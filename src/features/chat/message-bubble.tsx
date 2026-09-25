import { View } from 'react-native';

import { cn, Icon, Text, useThemeColors } from '@/design';
import { usePluginHost } from '@/core/plugins/host';
import type { ChatMessage, WidgetContent } from '@/core/messaging/types';
import type { MessageAction } from './message-actions';
import { BubbleShell, type ReplyPreview, type ThreadChip } from './bubble-shell';
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

export type { ReplyPreview, ThreadChip } from './bubble-shell';

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
