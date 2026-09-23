import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import * as Clipboard from 'expo-clipboard';

import { ActionSheet, cn, type SheetAction, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import { EXPLORERS, type LinkSegment, segmentText } from '@/core/messaging/links';
import { type Block, listMarker, parseMarkdown, type Span } from '@/core/messaging/markdown';
import { conversationScope } from '@/core/messaging/conversation-scope';
import { mapsLinks, parseLocation } from '@/core/messaging/locations';
import { usePluginHost } from '@/core/plugins/host';
import { openExternal, openInBrowser } from '@/lib/open-url';

interface Look {
  fromMe: boolean;
  className?: string;
  onHold: (link: LinkSegment) => void;
}

export function MessageText({
  text,
  fromMe,
  className,
  conversationId,
  onCommand,
}: {
  text: string;
  fromMe: boolean;
  className?: string;
  /** With `onCommand`, an address offers to send funds where /send can run. */
  conversationId?: string;
  onCommand?: (command: string) => void;
}) {
  const { registry } = usePluginHost();
  const [held, setHeld] = useState<LinkSegment | null>(null);
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const canSend =
    onCommand !== undefined &&
    conversationId !== undefined &&
    registry.commandsFor(conversationId, conversationScope(conversationId)).has('send');
  const look: Look = { fromMe, className, onHold: setHeld };
  const only = blocks.length === 1 ? blocks[0] : undefined;

  return (
    <>
      {only?.kind === 'paragraph' ? (
        <Text className={className}>
          <Spans spans={only.spans} look={look} />
        </Text>
      ) : (
        <View className="gap-1">
          <Blocks blocks={blocks} look={look} />
        </View>
      )}

      <ActionSheet
        visible={held !== null}
        onClose={() => setHeld(null)}
        title={held?.text}
        actions={held ? linkActions(held, canSend ? onCommand : undefined) : []}
      />
    </>
  );
}

function Blocks({ blocks, look }: { blocks: Block[]; look: Look }) {
  const { fromMe, className } = look;
  return blocks.map((block, i) => {
    const gap = block.spaced ? 'mt-1.5' : undefined;
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        return (
          <Text key={i} className={cn(className, block.kind === 'heading' && 'font-bold', gap)}>
            <Spans spans={block.spans} look={look} />
          </Text>
        );
      case 'code':
        return (
          <View
            key={i}
            style={{ borderCurve: 'continuous' }}
            className={cn(
              'rounded-lg px-2.5 py-1.5',
              fromMe ? 'bg-bubble-out-on/15' : 'bg-content/5',
              gap
            )}>
            <Text selectable className={cn(className, 'font-mono text-footnote')}>
              {block.text}
            </Text>
          </View>
        );
      case 'quote':
        return (
          <View key={i} className={cn('flex-row gap-2', gap)}>
            <View
              className={cn('w-0.5 rounded-full', fromMe ? 'bg-bubble-out-on/60' : 'bg-brand')}
            />
            <View className="min-w-0 flex-1 gap-1">
              <Blocks blocks={block.blocks} look={look} />
            </View>
          </View>
        );
      case 'list':
        return (
          <View key={i} className={cn('gap-0.5', gap)}>
            {block.items.map((item, n) => (
              <View key={n} className="flex-row gap-1.5">
                <Text className={className}>{listMarker(block, n)}</Text>
                <View className="min-w-0 flex-1 gap-1">
                  <Blocks blocks={item} look={look} />
                </View>
              </View>
            ))}
          </View>
        );
      case 'rule':
        return (
          <View
            key={i}
            className={cn('my-1 h-px', fromMe ? 'bg-bubble-out-on/30' : 'bg-line', gap)}
          />
        );
    }
  });
}

function Spans({ spans, look }: { spans: Span[]; look: Look }) {
  return spans.map((span, i) => {
    const style = cn(
      span.style.bold && 'font-bold',
      span.style.italic && 'italic',
      span.style.strike && 'line-through'
    );
    if (span.href) {
      return (
        <LinkText
          key={i}
          link={{ kind: 'url', text: span.text, href: span.href }}
          look={look}
          className={style}
        />
      );
    }
    if (span.style.code) {
      return (
        <Text
          key={i}
          className={cn(
            look.className,
            style,
            'font-mono',
            look.fromMe ? 'bg-bubble-out-on/15' : 'bg-content/5'
          )}>
          {span.text}
        </Text>
      );
    }
    const parts: ReactNode[] = segmentText(span.text).map((segment, n) =>
      segment.kind === 'text' ? (
        segment.text
      ) : (
        <LinkText key={n} link={segment} look={look} className={style} />
      )
    );
    return style ? (
      <Text key={i} className={cn(look.className, style)}>
        {parts}
      </Text>
    ) : (
      <Fragment key={i}>{parts}</Fragment>
    );
  });
}

function LinkText({
  link,
  look,
  className,
}: {
  link: LinkSegment;
  look: Look;
  className?: string;
}) {
  return (
    <Text
      accessibilityRole="link"
      suppressHighlighting
      onPress={() => openLink(link)}
      onLongPress={() => look.onHold(link)}
      className={cn(look.className, className, 'underline', !look.fromMe && 'text-brand')}>
      {link.text}
    </Text>
  );
}

export function openLink(link: LinkSegment) {
  const open =
    link.kind === 'phone' || link.kind === 'email'
      ? openExternal(link.href)
      : isPlace(link)
        ? openInMaps(link.href)
        : openInBrowser(link.href);
  open.catch((error) => toast.error(errorMessage(error, 'Could not open that')));
}

const isPlace = (link: LinkSegment) =>
  link.kind === 'location' || (link.kind === 'url' && parseLocation(link.href) !== null);

/** Hands a place to the device's maps app rather than a web page. */
export function openInMaps(url: string): Promise<unknown> {
  const location = parseLocation(url);
  if (!location) return openExternal(url);
  const links = mapsLinks(location);
  return openExternal(process.env.EXPO_OS === 'android' ? links.geo : links.apple);
}

function linkActions(link: LinkSegment, onCommand?: (command: string) => void): SheetAction[] {
  const copy = (label: string): SheetAction => ({
    label,
    icon: 'copy-outline',
    onPress: () => {
      Clipboard.setStringAsync(link.kind === 'url' ? link.href : link.text)
        .then(() => toast.success('Copied'))
        .catch(() => toast.error('Could not copy'));
    },
  });
  const open = (label: string, icon: SheetAction['icon']): SheetAction => ({
    label,
    icon,
    onPress: () => openLink(link),
  });
  const send: SheetAction[] = onCommand
    ? [
        {
          label: 'Send funds',
          icon: 'arrow-up-circle-outline',
          onPress: () => onCommand(`/send ${link.text}`),
        },
      ]
    : [];

  switch (link.kind) {
    case 'url':
      return isPlace(link)
        ? [open('Open in Maps', 'location-outline'), copy('Copy link')]
        : [open('Open link', 'open-outline'), copy('Copy link')];
    case 'phone':
      return [open('Call', 'call-outline'), copy('Copy number')];
    case 'email':
      return [open('Write an email', 'mail-outline'), copy('Copy address')];
    case 'location':
      return [open('Open in Maps', 'location-outline'), copy('Copy')];
    case 'address':
      return [
        open(`View on ${EXPLORERS[link.family].name}`, 'open-outline'),
        copy('Copy address'),
        ...send,
      ];
    case 'ens':
      return [open('View on ENS', 'open-outline'), copy('Copy name'), ...send];
  }
}
