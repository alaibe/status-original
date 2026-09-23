import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import {
  Eyebrow,
  Icon,
  type IconName,
  SearchField,
  Text,
  useEscapeKey,
  useLayoutInsets,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import { orderConversations } from '@/core/messaging/chat-prefs';
import { isUnreadHere, networkOf } from '@/core/messaging/folders';
import { protocolLabel } from '@/features/protocols/presentation';
import type { Conversation } from '@/core/messaging/types';
import { conversationTitle, useDisplayNames, usePeers } from '@/features/chat/use-display-names';
import { openChat, openTab } from '@/features/navigation/open';

interface Entry {
  id: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  conversation?: Conversation;
  selfId?: string;
  run: () => void;
}

const RECENT = 6;

/**
 * ⌘K on desktop: a search over conversations and a few commands, driven from
 * the keyboard. Enter opens the highlighted row; Esc puts it away. Only the
 * shortcuts live here, so nothing is computed while the palette is closed.
 */
export function QuickSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (!command || open) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        router.push('/new-chat');
      } else if (event.key === ',') {
        event.preventDefault();
        openTab('/settings');
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        event.preventDefault();
        openTab(event.key === '1' ? '/chats' : event.key === '2' ? '/contacts' : '/settings');
      }
    };
    // Capture phase: react-native-web stops keydown from bubbling out of inputs.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, router]);

  return open ? <QuickSwitcherPanel onClose={() => setOpen(false)} /> : null;
}

function QuickSwitcherPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useLayoutInsets();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  useEscapeKey(true, onClose);

  const conversations = useChatStore((s) => s.conversations);
  const sessions = useChatStore((s) => s.sessions);
  const chatPrefs = useChatStore((s) => s.chatPrefs);
  const readAt = useChatStore((s) => s.readAt);
  const { nameFor } = useDisplayNames(usePeers(conversations));

  const entries = useMemo<{ heading: string; items: Entry[] }[]>(() => {
    const allowed = conversations.filter((c) => c.consent === 'allowed');
    const context = { prefs: chatPrefs, readAt };
    const ordered = orderConversations(allowed, chatPrefs);
    const unread = ordered.filter((c) => isUnreadHere(c, context));
    const selfIdOf = (conversation: Conversation) => selfIdFor({ sessions }, conversation.protocol);
    const entry = (conversation: Conversation): Entry => {
      const network = networkOf(conversation);
      return {
        id: conversation.id,
        title: conversationTitle(conversation, selfIdOf(conversation), nameFor),
        subtitle: network ? protocolLabel(network) : undefined,
        conversation,
        selfId: selfIdOf(conversation),
        run: () => openChat(conversation.id),
      };
    };
    const chats = [...unread, ...ordered.filter((c) => !unread.includes(c))].map(entry);
    const commands: Entry[] = [
      {
        id: 'new',
        title: 'New message',
        subtitle: '⌘N',
        icon: 'create-outline',
        run: () => router.push('/new-chat'),
      },
      {
        id: 'contacts',
        title: 'Contacts',
        subtitle: '⌘2',
        icon: 'people-outline',
        run: () => openTab('/contacts'),
      },
      {
        id: 'settings',
        title: 'Settings',
        subtitle: '⌘,',
        icon: 'hardware-chip-outline',
        run: () => openTab('/settings'),
      },
    ];

    const q = query.trim().toLowerCase();
    if (!q) {
      return [
        { heading: 'Unread', items: chats.slice(0, unread.length) },
        { heading: 'Recent', items: chats.slice(unread.length, unread.length + RECENT) },
        { heading: 'Commands', items: commands },
      ].filter((section) => section.items.length > 0);
    }
    const matches = (entry: Entry) => entry.title.toLowerCase().includes(q);
    return [
      { heading: 'Chats', items: chats.filter(matches) },
      { heading: 'Commands', items: commands.filter(matches) },
    ].filter((section) => section.items.length > 0);
  }, [conversations, chatPrefs, readAt, sessions, nameFor, query, router]);

  const flat = entries.flatMap((section) => section.items);
  const highlighted = Math.min(index, Math.max(flat.length - 1, 0));

  const choose = (entry: Entry) => {
    onClose();
    entry.run();
  };

  const onKeyPress = (event: { nativeEvent: unknown; preventDefault(): void }) => {
    const key = event.nativeEvent as KeyboardEvent;
    if (key.key === 'ArrowDown' || (key.key === 'Tab' && !key.shiftKey)) {
      event.preventDefault();
      setIndex((value) => (flat.length ? (value + 1) % flat.length : 0));
    } else if (key.key === 'ArrowUp' || (key.key === 'Tab' && key.shiftKey)) {
      event.preventDefault();
      setIndex((value) => (flat.length ? (value - 1 + flat.length) % flat.length : 0));
    } else if (key.key === 'Enter') {
      event.preventDefault();
      const entry = flat[highlighted];
      if (entry) choose(entry);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ paddingLeft: insets.left }}
        className="flex-1 items-center bg-content/30 pt-[12vh]">
        <View
          onStartShouldSetResponder={() => true}
          style={{ borderCurve: 'continuous' }}
          className="max-h-[70vh] w-[560px] max-w-full overflow-hidden rounded-card bg-surface-raised shadow-xl">
          <SearchField
            className="m-3 h-11 px-4"
            autoFocus
            placeholder="Search"
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setIndex(0);
            }}
            onKeyPress={onKeyPress}
          />

          <ScrollView keyboardShouldPersistTaps="always">
            {flat.length === 0 ? (
              <Text variant="footnote" className="px-5 py-6 text-center">
                Nothing matches “{query.trim()}”.
              </Text>
            ) : null}
            {entries.map((section) => (
              <View key={section.heading}>
                <Eyebrow className="bg-surface px-5 py-1.5">{section.heading}</Eyebrow>
                {section.items.map((entry) => {
                  const active = flat[highlighted] === entry;
                  return (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      accessibilityLabel={entry.title}
                      onPress={() => choose(entry)}
                      onHoverIn={() => setIndex(flat.indexOf(entry))}
                      className={
                        active
                          ? 'flex-row items-center gap-3 bg-brand px-5 py-2.5'
                          : 'flex-row items-center gap-3 px-5 py-2.5'
                      }>
                      {entry.conversation && entry.selfId !== undefined ? (
                        <ConversationAvatar
                          conversation={entry.conversation}
                          selfId={entry.selfId}
                          size="sm"
                        />
                      ) : (
                        <View
                          className={
                            active
                              ? 'h-8 w-8 items-center justify-center rounded-pill bg-brand-on/20'
                              : 'h-8 w-8 items-center justify-center rounded-pill bg-surface-sunken'
                          }>
                          <Icon
                            name={entry.icon ?? 'sparkles-outline'}
                            size={18}
                            color={active ? colors['brand-on'] : colors['content-muted']}
                          />
                        </View>
                      )}
                      <Text
                        numberOfLines={1}
                        className={
                          active ? 'flex-1 font-medium text-brand-on' : 'flex-1 font-medium'
                        }>
                        {entry.title}
                      </Text>
                      {entry.subtitle ? (
                        <Text variant="caption" className={active ? 'text-brand-on/80' : undefined}>
                          {entry.subtitle}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <Text variant="caption" className="border-t border-line px-5 py-3 text-center">
            Tab or ↑ ↓ to move, ⏎ to open, Esc to close
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}
