import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useChatStore } from '@/core/messaging/chat-store';
import { conversationTitle } from '@/core/messaging/display-names';
import type { Directory, InboxRow } from '@/core/messaging/folders';
import { formatTimestamp, messagePreview } from '@/core/messaging/preview';
import type { Conversation } from '@/core/messaging/types';
import { unreadBadge } from '@/core/messaging/unread';
import {
  Enter,
  Icon,
  ListItem,
  NetworkMark,
  type MenuAnchor,
  Pressable,
  SwipeableRow,
  type SwipeAction,
  Text,
  useThemeColors,
} from '@/design';
import { protocolLabel } from '@/features/protocols/presentation';
import { ConversationAvatar } from './conversation-avatar';
import { CountBadge } from './folder-tabs';

export function ConversationRow({
  conversation,
  selfId,
  nameFor,
  unread,
  network,
  pinned,
  muted,
  onPress,
  onLongPress,
  onContextMenu,
  selected = false,
  left,
  right,
}: {
  conversation: Conversation;
  selfId: string;
  nameFor: (id: string) => string;
  unread: boolean;
  network?: string;
  pinned: boolean;
  muted: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onContextMenu: (anchor: MenuAnchor) => void;
  selected?: boolean;
  left?: SwipeAction[];
  right?: SwipeAction[];
}) {
  const colors = useThemeColors();
  const title = conversationTitle(conversation, selfId, nameFor);
  const last = conversation.lastMessage;
  const loaded = useChatStore((s) => s.messages[conversation.id]);
  const since = useChatStore((s) => s.readAt[conversation.id] ?? 0);

  return (
    <SwipeableRow left={left} right={right}>
      <ListItem
        testID={`conversation-${conversation.id}`}
        title={
          <>
            {title}
            {muted ? (
              <>
                {' '}
                <Icon name="volume-mute-outline" size={13} color={colors['content-subtle']} />
              </>
            ) : null}
          </>
        }
        accessibilityLabel={[title, conversation.typing ? 'typing' : messagePreview(last)]
          .filter(Boolean)
          .join(', ')}
        subtitle={conversation.typing ? 'typing…' : messagePreview(last)}
        onPress={onPress}
        onLongPress={onLongPress}
        onContextMenu={onContextMenu}
        selected={selected}
        unread={unread && !muted}
        leading={
          <ConversationAvatar
            conversation={conversation}
            selfId={selfId}
            size="md"
            network={network ? protocolLabel(network) : undefined}
          />
        }
        meta={
          last ? (
            <View className="flex-row items-center gap-1">
              {last.fromMe ? (
                <Icon
                  name={
                    last.status === 'failed'
                      ? 'alert-circle'
                      : last.status === 'sending'
                        ? 'time-outline'
                        : 'checkmark-done'
                  }
                  size={14}
                  color={
                    last.status === 'failed'
                      ? colors.danger
                      : last.readAt
                        ? colors.brand
                        : colors['content-subtle']
                  }
                />
              ) : null}
              <Text variant="caption" className={unread && !muted ? 'text-brand' : undefined}>
                {formatTimestamp(last.sentAt)}
              </Text>
            </View>
          ) : undefined
        }
        subtitleTrailing={
          unread ? (
            <CountBadge count={unreadBadge(conversation, since, loaded)} muted={muted} />
          ) : pinned ? (
            <Icon name="pin" size={14} color={colors['content-subtle']} />
          ) : undefined
        }
      />
    </SwipeableRow>
  );
}

const chatCount = (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`;

function directoryLabel(directory: Directory): string {
  return directory === 'archive' ? 'Archive' : protocolLabel(directory.slice('network:'.length));
}

function DirectoryIcon({ directory, size }: { directory: Directory; size: number }) {
  const colors = useThemeColors();
  if (directory !== 'archive') {
    return <NetworkMark network={directoryLabel(directory)} size={size} />;
  }
  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center rounded-pill bg-surface-sunken">
      <Icon name="archive-outline" size={size * 0.5} color={colors['content-muted']} />
    </View>
  );
}

export function DirectoryRow({
  row,
  unread,
  preview,
  onPress,
}: {
  row: Extract<InboxRow, { kind: 'directory' }>;
  unread: number;
  preview: string;
  onPress: () => void;
}) {
  const archive = row.directory === 'archive';
  const highlight = unread > 0 && !archive;
  return (
    <ListItem
      testID={`directory-${row.directory}`}
      title={directoryLabel(row.directory)}
      subtitle={preview}
      accessibilityLabel={`${directoryLabel(row.directory)}, ${chatCount(row.chats.length)}${unread ? `, ${unread} unread` : ''}`}
      onPress={onPress}
      unread={highlight}
      leading={<DirectoryIcon directory={row.directory} size={44} />}
      meta={
        row.latest.lastMessage ? (
          <Text variant="caption" className={highlight ? 'text-brand' : undefined}>
            {formatTimestamp(row.latest.lastMessage.sentAt)}
          </Text>
        ) : undefined
      }
      subtitleTrailing={unread > 0 ? <CountBadge count={unread} muted={archive} /> : undefined}
    />
  );
}

export function DirectoryHeader({
  directory,
  count,
  onBack,
}: {
  directory: Directory;
  count: number;
  onBack: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to all chats from ${directoryLabel(directory)}`}
      onPress={onBack}
      className="flex-row items-center gap-2 border-b border-line px-3 py-2">
      <Icon name="chevron-back" size={20} color={colors.brand} />
      <DirectoryIcon directory={directory} size={22} />
      <Text className="flex-1 font-semibold" numberOfLines={1}>
        {directoryLabel(directory)}
      </Text>
      <Text variant="caption">{chatCount(count)}</Text>
    </Pressable>
  );
}

export function Separator() {
  return <View className="ml-[76px] mr-3 h-px bg-line" />;
}

export function ConnectingState() {
  return (
    <Animated.View entering={Enter.fade()} className="gap-1 px-gutter pt-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} className="min-h-tap flex-row items-center gap-3 py-2.5">
          <View className="h-11 w-11 rounded-pill bg-surface-sunken" />
          <View className="flex-1 gap-2">
            <View className="h-3 w-1/3 rounded-pill bg-surface-sunken" />
            <View className="h-2.5 w-2/3 rounded-pill bg-surface-sunken" />
          </View>
        </View>
      ))}
      <Text variant="caption" className="mt-3 text-center">
        Fetching history…
      </Text>
    </Animated.View>
  );
}
