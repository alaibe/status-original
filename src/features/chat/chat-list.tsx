import { useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';
import { useEffect, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  ActionSheet,
  Badge,
  EmptyState,
  Enter,
  Icon,
  ListItem,
  NetworkMark,
  type MenuAnchor,
  Pressable,
  SwipeableRow,
  type SwipeAction,
  Text,
  useEscapeKey,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation } from '@/core/messaging/types';
import { formatTimestamp, messagePreview } from '@/core/messaging/preview';
import { orderConversations, type ChatPrefs } from '@/core/messaging/chat-prefs';
import {
  type Directory,
  type InboxRow,
  inboxRows,
  inDirectory,
  isUnreadHere,
  matchesFilter,
  networkOf,
} from '@/core/messaging/folders';
import { hasUnreadMentions, isUnread, unreadBadge } from '@/core/messaging/unread';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { conversationTitle } from '@/core/messaging/display-names';
import { useDisplayNames, usePeers } from '@/features/chat/use-display-names';
import { protocolLabel, protocolSubtitle } from '@/features/protocols/presentation';
import { HistoryStatus } from '@/features/chat/history-status';
import { CountBadge, FilterTabs } from '@/features/chat/folder-tabs';
import { useFolderStore } from '@/features/chat/folder-store';
import { useUnreadCounts } from '@/features/chat/use-unread-counts';
import { protocolById } from '@/protocols';
import { openChat } from '@/features/navigation/open';

export interface ChatListProps {
  query: string;
  /** The conversation open beside the list, on layouts that show both. */
  selectedId?: string;
}

/** The conversation list: the Chats tab on a phone, the sidebar on desktop. */
export function ChatList({ query, selectedId }: ChatListProps) {
  const router = useRouter();
  const colors = useThemeColors();

  const baseConversations = useChatStore((s) => s.conversations);
  const status = useChatStore((s) => s.status);

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (baseConversations.length > 0 || status === 'ready' || status === 'error') {
      markInteractive();
    }
  }, [baseConversations.length, status, markInteractive]);
  const syncing = useChatStore((s) => s.syncing);
  const fetchingHistory = useChatStore((s) =>
    Object.values(s.protocols).some(
      (p) => p.status === 'connecting' || p.history?.status === 'fetching'
    )
  );
  const sync = useChatStore((s) => s.sync);
  const sessions = useChatStore((s) => s.sessions);
  const readAt = useChatStore((s) => s.readAt);
  const conversations = useUnreadCounts(baseConversations);

  const selfIdOf = (conversation: Conversation) => selfIdFor({ sessions }, conversation.protocol);

  const { nameFor } = useDisplayNames(usePeers(conversations));
  const chatPrefs = useChatStore((s) => s.chatPrefs);
  const setChatPref = useChatStore((s) => s.setChatPref);
  const markUnread = useChatStore((s) => s.markUnread);
  const toggle = (id: string, key: keyof ChatPrefs) =>
    setChatPref(id, { [key]: !chatPrefs[id]?.[key] });

  const [menu, setMenu] = useState<{
    conversation: Conversation;
    anchor: MenuAnchor | null;
  } | null>(null);
  const managing = menu?.conversation ?? null;
  const directory = useFolderStore((s) => s.directory);
  const setDirectory = useFolderStore((s) => s.setDirectory);
  const filter = useFolderStore((s) => s.filter);
  const setFilter = useFolderStore((s) => s.setFilter);
  const [navigated, setNavigated] = useState(false);

  const { allowed, requests } = {
    allowed: conversations.filter((c) => c.consent === 'allowed'),
    requests: conversations.filter((c) => c.consent === 'unknown'),
  };

  const folderContext = { prefs: chatPrefs, readAt };
  const ordered = orderConversations(allowed, chatPrefs, { includeArchived: true });
  const scope = directory
    ? ordered.filter((c) => inDirectory(c, directory, folderContext))
    : ordered.filter((c) => !chatPrefs[c.id]?.archived);

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const matchesQuery = (c: Conversation) =>
    !q ||
    conversationTitle(c, selfIdOf(c), nameFor).toLowerCase().includes(q) ||
    messagePreview(c.lastMessage).toLowerCase().includes(q);

  // A chat read under Unread stays until the view changes, rather than vanishing under the pointer.
  const view = `${directory}|${filter}`;
  const [kept, setKept] = useState<{ view: string; ids: string[] }>({ view, ids: [] });
  if (filter === 'unread') {
    const held = kept.view === view ? kept.ids : [];
    const added = scope
      .filter((c) => isUnreadHere(c, folderContext) && !held.includes(c.id))
      .map((c) => c.id);
    if (kept.view !== view || added.length > 0) setKept({ view, ids: [...held, ...added] });
  }
  const include = (c: Conversation) =>
    matchesQuery(c) &&
    (matchesFilter(c, filter, folderContext) || (filter === 'unread' && kept.ids.includes(c.id)));

  const folded = (network: string) => protocolById(network)?.external ?? true;
  const rows: InboxRow[] =
    directory || q
      ? scope.filter(include).map((conversation) => ({ kind: 'chat', conversation }))
      : inboxRows(ordered, include, folded, folderContext);
  const unreadHere = scope.filter((c) => isUnreadHere(c, folderContext)).length;
  const mentionsHere = scope.filter((c) => hasUnreadMentions(c, readAt)).length;

  const go = (next: Directory | null) => {
    setNavigated(true);
    setDirectory(next);
  };
  const leaveDirectory = () => go(null);
  useEscapeKey(directory !== null, leaveDirectory);

  const managed = managing ? chatPrefs[managing.id] : undefined;
  const choose = (key: keyof ChatPrefs) => {
    if (managing) toggle(managing.id, key);
  };

  const nativeNetworks = new Set(
    scope.map(networkOf).filter((n): n is string => n !== undefined && !folded(n))
  );
  const showNetwork = !directory && nativeNetworks.size > 1;

  return (
    <>
      {conversations.length > 0 ? (
        <FilterTabs
          active={filter}
          onSelect={setFilter}
          unread={unreadHere}
          mentions={mentionsHere}
        />
      ) : null}
      {directory ? (
        <DirectoryHeader directory={directory} onBack={leaveDirectory} count={scope.length} />
      ) : null}
      <HistoryStatus compact />
      {(status === 'connecting' || fetchingHistory) && conversations.length === 0 ? (
        <ConnectingState />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={<Icon name="chatbubbles-outline" size={44} color={colors['content-subtle']} />}
          title="No conversations yet"
          description="Start one with an Ethereum address on XMTP, or a public key on Nostr or Waku."
          actionLabel="New conversation"
          onAction={() => router.push('/new-chat')}
        />
      ) : (
        <Animated.View
          key={directory ?? 'inbox'}
          entering={navigated ? (directory ? Enter.fromRight() : Enter.fromLeft()) : undefined}
          className="flex-1">
          <FlashList
            data={rows}
            keyExtractor={(row) => (row.kind === 'chat' ? row.conversation.id : row.directory)}
            getItemType={(row) => row.kind}
            ItemSeparatorComponent={Separator}
            contentInsetAdjustmentBehavior="automatic"
            ListEmptyComponent={
              <EmptyState
                icon={<Icon name="search-outline" size={40} color={colors['content-subtle']} />}
                title={
                  trimmed
                    ? 'No matching chats'
                    : filter === 'unread'
                      ? 'All caught up'
                      : 'Nothing here'
                }
                description={
                  trimmed
                    ? `No chats match “${trimmed}”.`
                    : filter === 'unread'
                      ? 'Nothing unread here.'
                      : 'Try another filter.'
                }
              />
            }
            refreshControl={
              <RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.brand} />
            }
            ListHeaderComponent={
              <>
                {requests.length > 0 && !directory ? (
                  <Pressable
                    testID="open-requests"
                    accessibilityRole="button"
                    onPress={() => router.push('/requests')}
                    className="mx-gutter mb-2 min-h-tap flex-row items-center gap-3 rounded-card border border-line bg-surface px-3 py-3">
                    <Icon name="mail-unread-outline" size={20} color={colors.brand} />
                    <View className="min-w-0 flex-1">
                      <Text className="font-semibold">Message requests</Text>
                      <Text variant="caption">From people you haven’t replied to</Text>
                    </View>
                    <Badge label={String(requests.length)} tone="brand" />
                  </Pressable>
                ) : null}
              </>
            }
            renderItem={({ item: row }) => {
              if (row.kind === 'directory') {
                return (
                  <DirectoryRow
                    row={row}
                    unread={row.chats.filter((c) => isUnreadHere(c, folderContext)).length}
                    preview={`${conversationTitle(row.latest, selfIdOf(row.latest), nameFor)}: ${messagePreview(row.latest.lastMessage)}`}
                    onPress={() => go(row.directory)}
                  />
                );
              }
              const item = row.conversation;
              const prefs = chatPrefs[item.id];
              return (
                <ConversationRow
                  conversation={item}
                  selfId={selfIdOf(item)}
                  nameFor={nameFor}
                  unread={isUnread(item, readAt)}
                  network={showNetwork ? networkOf(item) : undefined}
                  pinned={Boolean(prefs?.pinned)}
                  muted={Boolean(prefs?.muted)}
                  onPress={() => openChat(item.id)}
                  selected={item.id === selectedId}
                  onLongPress={() => setMenu({ conversation: item, anchor: null })}
                  onContextMenu={(anchor) => setMenu({ conversation: item, anchor })}
                  left={[
                    {
                      id: 'pin',
                      label: prefs?.pinned ? 'Unpin' : 'Pin',
                      icon: 'pin-outline',
                      tone: 'neutral',
                      onPress: () => toggle(item.id, 'pinned'),
                    },
                  ]}
                  right={[
                    {
                      id: 'mute',
                      label: prefs?.muted ? 'Unmute' : 'Mute',
                      icon: prefs?.muted ? 'volume-high-outline' : 'volume-mute-outline',
                      tone: 'warning',
                      onPress: () => toggle(item.id, 'muted'),
                    },
                    {
                      id: 'archive',
                      label: prefs?.archived ? 'Unarchive' : 'Archive',
                      icon: 'archive-outline',
                      tone: 'brand',
                      onPress: () => toggle(item.id, 'archived'),
                    },
                  ]}
                />
              );
            }}
          />
        </Animated.View>
      )}

      <ActionSheet
        visible={menu !== null}
        anchor={menu?.anchor}
        onClose={() => setMenu(null)}
        title={managing ? conversationTitle(managing, selfIdOf(managing), nameFor) : undefined}
        subtitle={managing ? protocolSubtitle(managing.protocol) : undefined}
        leading={
          managing ? (
            <ConversationAvatar conversation={managing} selfId={selfIdOf(managing)} size="md" />
          ) : undefined
        }
        actions={[
          {
            label: managed?.pinned ? 'Unpin' : 'Pin to top',
            icon: 'pin-outline',
            onPress: () => choose('pinned'),
          },
          {
            label: managed?.muted ? 'Unmute' : 'Mute',
            icon: managed?.muted ? 'volume-high-outline' : 'volume-mute-outline',
            onPress: () => choose('muted'),
          },
          {
            label: managed?.archived ? 'Move out of archive' : 'Archive',
            icon: 'archive-outline',
            onPress: () => choose('archived'),
          },
          {
            label: 'Mark as unread',
            icon: 'mail-unread-outline',
            onPress: () => {
              if (managing) void markUnread(managing.id);
            },
          },
        ]}
      />
    </>
  );
}

function ConversationRow({
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

function DirectoryRow({
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

function DirectoryHeader({
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

function Separator() {
  return <View className="ml-[76px] mr-3 h-px bg-line" />;
}

function ConnectingState() {
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
