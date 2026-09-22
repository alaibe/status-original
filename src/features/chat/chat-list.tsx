import { useRouter } from 'expo-router';
import { useObserve } from 'expo-observe';
import { useEffect, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  ActionSheet,
  Badge,
  EmptyState,
  Enter,
  Icon,
  ListItem,
  type MenuAnchor,
  Pressable,
  SwipeableRow,
  type SwipeAction,
  Text,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation } from '@/core/messaging/types';
import { formatTimestamp, messagePreview } from '@/core/messaging/preview';
import { archivedCount, orderConversations, type ChatPrefs } from '@/core/messaging/chat-prefs';
import { availableFolders, matchesFolder, type FolderId } from '@/core/messaging/folders';
import { isUnread } from '@/core/messaging/unread';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { conversationTitle, useDisplayNames, usePeers } from '@/features/chat/use-display-names';
import { protocolBadge, protocolSubtitle } from '@/features/protocols/presentation';
import { HistoryStatus } from '@/features/chat/history-status';
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

  const conversations = useChatStore((s) => s.conversations);
  const status = useChatStore((s) => s.status);

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (conversations.length > 0 || status === 'ready' || status === 'error') {
      markInteractive();
    }
  }, [conversations.length, status, markInteractive]);
  const syncing = useChatStore((s) => s.syncing);
  const fetchingHistory = useChatStore((s) =>
    Object.values(s.protocols).some(
      (p) => p.status === 'connecting' || p.history?.status === 'fetching'
    )
  );
  const sync = useChatStore((s) => s.sync);
  const sessions = useChatStore((s) => s.sessions);

  const selfIdOf = (conversation: Conversation) => selfIdFor({ sessions }, conversation.protocol);

  const { nameFor } = useDisplayNames(usePeers(conversations));
  const readAt = useChatStore((s) => s.readAt);
  const chatPrefs = useChatStore((s) => s.chatPrefs);
  const setChatPref = useChatStore((s) => s.setChatPref);
  const toggle = (id: string, key: keyof ChatPrefs) =>
    setChatPref(id, { [key]: !chatPrefs[id]?.[key] });

  const [menu, setMenu] = useState<{
    conversation: Conversation;
    anchor: MenuAnchor | null;
  } | null>(null);
  const managing = menu?.conversation ?? null;
  const [showArchived, setShowArchived] = useState(false);
  const [chosenFolder, setFolder] = useState<FolderId>('all');

  const { allowed, requests } = {
    allowed: conversations.filter((c) => c.consent === 'allowed'),
    requests: conversations.filter((c) => c.consent === 'unknown'),
  };

  const folderContext = { prefs: chatPrefs, readAt };
  const folders = availableFolders(allowed, folderContext);

  const folder = folders.some((f) => f.id === chosenFolder) ? chosenFolder : 'all';

  const ordered = showArchived
    ? orderConversations(allowed, chatPrefs, { includeArchived: true }).filter(
        (c) => chatPrefs[c.id]?.archived
      )
    : orderConversations(allowed, chatPrefs);
  const inFolder = ordered.filter((c) => matchesFolder(c, folder, folderContext));

  const q = query.trim().toLowerCase();
  const visible = q
    ? inFolder.filter((c) => {
        const title = conversationTitle(c, selfIdOf(c), nameFor).toLowerCase();
        return title.includes(q) || messagePreview(c.lastMessage).toLowerCase().includes(q);
      })
    : inFolder;

  const archived = archivedCount(allowed, chatPrefs);

  const managed = managing ? chatPrefs[managing.id] : undefined;
  const choose = (key: keyof ChatPrefs) => {
    if (managing) toggle(managing.id, key);
  };

  const networked = new Set(
    conversations.map((c) => c.protocol).filter((p): p is string => Boolean(p) && p !== 'local')
  );
  const showProtocol = networked.size > 1;

  return (
    <>
      <HistoryStatus />
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
        <FlashList
          data={visible}
          keyExtractor={(c) => c.id}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <EmptyState
              icon={<Icon name="search-outline" size={40} color={colors['content-subtle']} />}
              title={
                query.trim()
                  ? 'No matching chats'
                  : showArchived
                    ? 'No archived chats'
                    : 'Nothing in this folder'
              }
              description={
                query.trim()
                  ? `No chats match “${query.trim()}”.`
                  : showArchived
                    ? 'Chats you archive will appear here.'
                    : 'Choose another folder to see your other chats.'
              }
            />
          }
          refreshControl={
            <RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.brand} />
          }
          ListHeaderComponent={
            <>
              {folders.length > 1 && !showArchived ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2 px-gutter pb-3 pt-2.5">
                  {folders.map((entry) => {
                    const active = entry.id === folder;
                    return (
                      <Pressable
                        key={entry.id}
                        accessibilityRole="button"
                        accessibilityLabel={entry.label}
                        onPress={() => setFolder(entry.id)}
                        hitSlop={8}
                        className={
                          active
                            ? 'rounded-pill bg-brand px-3.5 py-2'
                            : 'rounded-pill bg-surface-sunken px-3.5 py-2'
                        }>
                        <Text
                          variant="caption"
                          className={
                            active ? 'font-semibold text-brand-on' : 'font-medium text-content'
                          }>
                          {entry.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              {archived > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowArchived((v) => !v)}
                  className="mx-gutter mb-2 min-h-tap flex-row items-center gap-3 rounded-card border border-line bg-surface px-3 py-3">
                  <Icon
                    name={showArchived ? 'arrow-back' : 'archive-outline'}
                    size={20}
                    color={colors['content-muted']}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="font-semibold">
                      {showArchived ? 'Back to chats' : 'Archived'}
                    </Text>
                  </View>
                  {!showArchived ? <Badge label={String(archived)} tone="neutral" /> : null}
                </Pressable>
              ) : null}
              {requests.length > 0 && !showArchived ? (
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
          renderItem={({ item }) => {
            const prefs = chatPrefs[item.id];
            return (
              <ConversationRow
                conversation={item}
                selfId={selfIdOf(item)}
                nameFor={nameFor}
                unread={isUnread(item, readAt)}
                showProtocol={showProtocol}
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
  showProtocol,
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
  showProtocol: boolean;
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
  const badge = showProtocol ? protocolBadge(conversation.protocol) : null;

  return (
    <View>
      <SwipeableRow left={left} right={right}>
        <ListItem
          testID={`conversation-${conversation.id}`}
          title={title}
          subtitle={messagePreview(conversation.lastMessage)}
          onPress={onPress}
          onLongPress={onLongPress}
          onContextMenu={onContextMenu}
          selected={selected}
          unread={unread && !muted}
          leading={<ConversationAvatar conversation={conversation} selfId={selfId} size="md" />}
          trailing={
            <View className="items-end gap-1">
              {conversation.lastMessage ? (
                <View className="flex-row items-center gap-1">
                  {conversation.lastMessage.fromMe ? (
                    <Icon
                      name={
                        conversation.lastMessage.status === 'failed'
                          ? 'alert-circle'
                          : conversation.lastMessage.status === 'sending'
                            ? 'time-outline'
                            : 'checkmark-done'
                      }
                      size={14}
                      color={
                        conversation.lastMessage.status === 'failed'
                          ? colors.danger
                          : conversation.lastMessage.readAt
                            ? colors.brand
                            : colors['content-subtle']
                      }
                    />
                  ) : null}
                  <Text
                    variant="caption"
                    className={unread ? 'font-semibold text-brand' : undefined}>
                    {formatTimestamp(conversation.lastMessage.sentAt)}
                  </Text>
                </View>
              ) : null}

              {muted || pinned || badge || unread ? (
                <View className="flex-row items-center gap-1.5">
                  {muted ? (
                    <Icon name="volume-mute-outline" size={13} color={colors['content-subtle']} />
                  ) : null}
                  {pinned ? <Icon name="pin" size={13} color={colors['content-subtle']} /> : null}
                  {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
                  {unread ? <UnreadDot /> : null}
                </View>
              ) : null}
            </View>
          }
        />
      </SwipeableRow>
    </View>
  );
}

function UnreadDot() {
  return <View accessibilityLabel="Unread" className="h-2.5 w-2.5 rounded-pill bg-brand" />;
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
