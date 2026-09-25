import { useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
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
import { type ChatState, selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation, ConversationId } from '@/core/messaging/types';
import { messagePreview } from '@/core/messaging/preview';
import { orderConversations, type ChatPrefs, type ChatPrefsMap } from '@/core/messaging/chat-prefs';
import {
  type ChatFilter,
  chatRow,
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
import {
  ConnectingState,
  ConversationRow,
  DirectoryHeader,
  DirectoryRow,
  Separator,
} from './chat-list-rows';

const NO_IDS: ReadonlySet<string> = new Set();

const isFolded = (network: string) => protocolById(network)?.external ?? true;

function inbox({
  conversations,
  chatPrefs,
  readAt,
  directory,
  filter,
  query,
  held,
  sessions,
  nameFor,
}: {
  conversations: Conversation[];
  chatPrefs: ChatPrefsMap;
  readAt: Record<ConversationId, number>;
  directory: Directory | null;
  filter: ChatFilter;
  query: string;
  held: ReadonlySet<string>;
  sessions: ChatState['sessions'];
  nameFor: (id: string) => string;
}) {
  const titleOf = (c: Conversation) =>
    conversationTitle(c, selfIdFor({ sessions }, c.protocol), nameFor);
  const allowed = conversations.filter((c) => c.consent === 'allowed');
  const requests = conversations.filter((c) => c.consent === 'unknown');
  const context = { prefs: chatPrefs, readAt };
  const ordered = orderConversations(allowed, chatPrefs, { includeArchived: true });
  const scope = directory
    ? ordered.filter((c) => inDirectory(c, directory, context))
    : ordered.filter((c) => !chatPrefs[c.id]?.archived);
  const unread = scope.filter((c) => isUnreadHere(c, context));

  const q = query.trim().toLowerCase();
  const include = (c: Conversation) =>
    (!q ||
      titleOf(c).toLowerCase().includes(q) ||
      messagePreview(c.lastMessage).toLowerCase().includes(q)) &&
    (matchesFilter(c, filter, context) || (filter === 'unread' && held.has(c.id)));
  const nativeNetworks = new Set(
    scope.map(networkOf).filter((n): n is string => n !== undefined && !isFolded(n))
  );

  return {
    allowed,
    requests,
    scope,
    rows:
      directory || q
        ? scope.filter(include).map(chatRow)
        : inboxRows(ordered, include, isFolded, context),
    unseen: filter === 'unread' ? unread.filter((c) => !held.has(c.id)).map((c) => c.id) : [],
    unreadHere: unread.length,
    mentionsHere: scope.filter((c) => hasUnreadMentions(c, readAt)).length,
    showNetwork: !directory && nativeNetworks.size > 1,
  };
}

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
    setChatPref(id, { [key]: !useChatStore.getState().chatPrefs[id]?.[key] });

  const [menu, setMenu] = useState<{
    conversation: Conversation;
    anchor: MenuAnchor | null;
  } | null>(null);
  const showMenu = (conversation: Conversation, anchor: MenuAnchor | null) =>
    setMenu({ conversation, anchor });
  const managing = menu?.conversation ?? null;
  const directory = useFolderStore((s) => s.directory);
  const setDirectory = useFolderStore((s) => s.setDirectory);
  const filter = useFolderStore((s) => s.filter);
  const setFilter = useFolderStore((s) => s.setFilter);
  const [navigated, setNavigated] = useState(false);

  // A chat read under Unread stays until the view changes, rather than vanishing under the pointer.
  const view = `${directory}|${filter}`;
  const [kept, setKept] = useState({ view, ids: NO_IDS });
  const held = kept.view === view ? kept.ids : NO_IDS;
  const titleOf = (c: Conversation) => conversationTitle(c, selfIdOf(c), nameFor);
  const deferredQuery = useDeferredValue(query);
  const { allowed, requests, scope, rows, unseen, unreadHere, mentionsHere, showNetwork } = useMemo(
    () =>
      inbox({
        conversations,
        chatPrefs,
        readAt,
        directory,
        filter,
        query: deferredQuery,
        held,
        sessions,
        nameFor,
      }),
    [conversations, chatPrefs, readAt, directory, filter, deferredQuery, held, sessions, nameFor]
  );
  if (unseen.length > 0) setKept({ view, ids: new Set([...held, ...unseen]) });

  const trimmed = query.trim();
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
  const go = (next: Directory | null) => {
    setNavigated(true);
    setDirectory(next);
  };
  const leaveDirectory = () => go(null);
  useEscapeKey(directory !== null, leaveDirectory);
  const openSelectedDirectory = useEffectEvent(() => {
    const selected = allowed.find((c) => c.id === selectedId);
    if (!selected || selectedListed || trimmed) return;
    const network = networkOf(selected);
    const home: Directory | null = chatPrefs[selected.id]?.archived
      ? 'archive'
      : network && isFolded(network) && !chatPrefs[selected.id]?.pinned
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

  const folderContext = { prefs: chatPrefs, readAt };
  const renderItem = ({ item: row }: ListRenderItemInfo<InboxRow>) =>
    row.kind === 'directory' ? (
      <DirectoryRow
        row={row}
        unread={row.chats.filter((c) => isUnreadHere(c, folderContext)).length}
        preview={`${titleOf(row.latest)}: ${messagePreview(row.latest.lastMessage)}`}
        onPress={() => go(row.directory)}
      />
    ) : (
      <ConversationRow
        conversation={row.conversation}
        selfId={selfIdOf(row.conversation)}
        nameFor={nameFor}
        unread={isUnread(row.conversation, readAt)}
        network={showNetwork ? networkOf(row.conversation) : undefined}
        prefs={chatPrefs[row.conversation.id]}
        selected={row.conversation.id === selectedId}
        onMenu={showMenu}
        onToggle={toggle}
      />
    );

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
            renderItem={renderItem}
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
