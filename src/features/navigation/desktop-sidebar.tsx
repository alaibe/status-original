import { useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { DRAG_REGION, Icon, IconButton, type IconName, Pressable, SearchField, Text, useThemeColors } from '@/design';
import { ChatList } from '@/features/chat/chat-list';
import { ContactList, type ContactSort } from '@/features/contacts/contact-list';
import { SettingsProfile, useEnsName } from '@/features/settings/settings-profile';
import {
  SETTINGS_PAGES,
  type SettingsPage,
  SettingsSections,
  useSettingsKeys,
} from '@/features/settings/settings-sections';

import { DIALOG_SEGMENTS } from './routes';

type Tab = 'chats' | 'contacts' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName; href: '/chats' | '/contacts' | '/settings' }[] = [
  { id: 'chats', label: 'Chats', icon: 'chatbubbles-outline', href: '/chats' },
  { id: 'contacts', label: 'Contacts', icon: 'people-outline', href: '/contacts' },
  { id: 'settings', label: 'Settings', icon: 'hardware-chip-outline', href: '/settings' },
];

/** The traffic lights sit inside the card's top-left corner; the title row clears them. */
const TRAFFIC_LIGHTS_WIDTH = 64;

/**
 * The left column of the desktop window: the list for the active tab, with
 * search above it and the tab strip below. Settings opens in the pane, so the
 * list stays where it was.
 */
export function DesktopSidebar() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const params = useGlobalSearchParams<{ id?: string }>();
  const colors = useThemeColors();

  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<ContactSort>('name');
  const [sorting, setSorting] = useState(false);

  // Dialogs float over the window, so the sidebar keeps the tab they were opened from.
  const routed: Tab | null = segments.includes('(contacts)')
    ? 'contacts'
    : segments.includes('(settings)')
      ? 'settings'
      : DIALOG_SEGMENTS.has(segments[0])
        ? null
        : 'chats';
  const [lastTab, setLastTab] = useState<Tab>('chats');
  if (routed && routed !== lastTab) setLastTab(routed);
  const tab = routed ?? lastTab;
  const selectedId = segments[0] === 'chat' ? params.id : undefined;
  const settingsPage = segments.find((segment): segment is SettingsPage =>
    (SETTINGS_PAGES as readonly string[]).includes(segment),
  );

  // Keys and the ENS name can only change on a settings page, so that is when they reload.
  const revision = tab === 'settings' ? (settingsPage ?? 'settings') : null;
  const { gifKey, tokenKey } = useSettingsKeys(revision);
  const ensName = useEnsName(revision);

  return (
    <View
      style={{ borderCurve: 'continuous' }}
      className="w-[320px] flex-1 overflow-hidden rounded-card bg-surface shadow-md">
      <View {...DRAG_REGION} className="flex-row items-center px-2 pb-1 pt-2">
        <View style={{ width: TRAFFIC_LIGHTS_WIDTH }} />
        <Text variant="title" className="flex-1 text-center font-semibold">
          {TABS.find((entry) => entry.id === tab)?.label}
        </Text>
        <View className="flex-row items-center justify-end" style={{ minWidth: TRAFFIC_LIGHTS_WIDTH }}>
          {tab === 'settings' ? null : tab === 'contacts' ? (
            <IconButton
              icon="swap-horizontal-outline"
              label="Sort contacts"
              onPress={() => setSorting(true)}
            />
          ) : (
            <IconButton
              icon="people-outline"
              label="New group"
              onPress={() => router.push('/new-chat?mode=group')}
            />
          )}
          {tab === 'settings' ? null : (
            <IconButton
              icon="create-outline"
              label="New message"
              tone="brand"
              onPress={() => router.push('/new-chat')}
            />
          )}
        </View>
      </View>

      {tab === 'settings' ? null : (
        <SearchField
          className="mx-3 mb-2 bg-surface-raised"
          placeholder="Search"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
        />
      )}

      <View className="flex-1">
        {tab === 'settings' ? (
          <ScrollView>
            <SettingsProfile ensName={ensName} />
            <SettingsSections gifKey={gifKey} tokenKey={tokenKey} selected={settingsPage} compact />
          </ScrollView>
        ) : tab === 'contacts' ? (
          <ContactList
            query={query}
            sortBy={sortBy}
            sorting={sorting}
            onSort={setSortBy}
            onCloseSort={() => setSorting(false)}
            selectedConversationId={selectedId}
          />
        ) : (
          <ChatList query={query} selectedId={selectedId} />
        )}
      </View>

      <View className="flex-row border-t border-line">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={entry.label}
              onPress={() => router.navigate(entry.href)}
              className="flex-1 items-center gap-0.5 py-2">
              <Icon
                name={entry.icon}
                size={22}
                color={active ? colors.brand : colors['content-muted']}
              />
              <Text
                variant="caption"
                className={active ? 'font-semibold text-brand' : 'text-content-muted'}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
