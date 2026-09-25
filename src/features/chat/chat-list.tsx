import { useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  ActionSheet,
  Badge,
  EmptyState,
  Enter,
  Icon,
  type MenuAnchor,
  Pressable,
  Text,
  useEscapeKey,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation } from '@/core/messaging/types';
import { messagePreview } from '@/core/messaging/preview';
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
import { hasUnreadMentions, isUnread } from '@/core/messaging/unread';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { conversationTitle } from '@/core/messaging/display-names';
import { useDisplayNames, usePeers } from '@/features/chat/use-display-names';
import { protocolSubtitle } from '@/features/protocols/presentation';
import { HistoryStatus } from '@/features/chat/history-status';
import { FilterTabs } from '@/features/chat/folder-tabs';
import { useFolderStore } from '@/features/chat/folder-store';
import { useUnreadCounts } from '@/features/chat/use-unread-counts';
import { protocolById } from '@/protocols';
import { openChat } from '@/features/navigation/open';
import {
  ConnectingState,
  ConversationRow,
  DirectoryHeader,
  DirectoryRow,
  Separator,
} from './chat-list-rows';

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
  const list = useRef<FlashListRef<InboxRow>>(null);
  const selectedIndex = rows.findIndex(
    (row) => row.kind === 'chat' && row.conversation.id === selectedId
  );
  const selectedListed = selectedIndex >= 0;
  const revealSelected = useEffectEvent(() => {
    const view = list.current;
    if (!view || selectedIndex < 0) return;
    const { startIndex, endIndex } = view.computeVisibleIndices();
    if (selectedIndex > startIndex && selectedIndex < endIndex) return;
    void view.scrollToIndex({ index: selectedIndex, animated: true, viewPosition: 0.5 });
  });
  // Only when the selection changes: a selected chat that moves on a new message stays put.
  useEffect(() => {
    if (selectedListed) revealSelected();
  }, [selectedId, selectedListed]);
  const unreadHere = scope.filter((c) => isUnreadHere(c, folderContext)).length;
  const mentionsHere = scope.filter((c) => hasUnreadMentions(c, readAt)).length;

  const go = (next: Directory | null) => {
    setNavigated(true);
    setDirectory(next);
  };
  const leaveDirectory = () => go(null);
  useEscapeKey(directory !== null, leaveDirectory);
  const openSelectedDirectory = useEffectEvent(() => {
    const selected = allowed.find((c) => c.id === selectedId);
    if (!selected || selectedListed || q) return;
    const network = networkOf(selected);
    const home: Directory | null = chatPrefs[selected.id]?.archived
      ? 'archive'
      : network && folded(network) && !chatPrefs[selected.id]?.pinned
        ? `network:${network}`
        : null;
    if (home !== directory) setDirectory(home);
  });
  useEffect(() => {
    openSelectedDirectory();
  }, [selectedId]);

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
            ref={list}
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
