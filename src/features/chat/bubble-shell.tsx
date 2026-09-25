import { useRef, useState } from 'react';
import { Pressable as RNPressable, View } from 'react-native';

import { cn, Icon, Text, useThemeColors } from '@/design';
import { MessageActions, type MessageAction, type MessageAnchor } from './message-actions';

export interface ReplyPreview {
  author: string;
  preview: string;
}

export interface ThreadChip {
  replies: number;
  onOpen(): void;
}

export function BubbleShell({
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

function repliesLabel(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`;
}
