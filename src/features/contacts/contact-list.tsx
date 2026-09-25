import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import {
  ActionSheet,
  Avatar,
  Button,
  Card,
  Icon,
  ListItem,
  Section,
  Text,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore, type ChatState } from '@/core/messaging/chat-store';
import { useDisplayNames } from '@/features/chat/use-display-names';
import {
  currentAccess,
  manageLimitedAccess,
  type ContactAccess,
} from '@/features/contacts/device-contacts';
import { fromPeerKey, peerKey, peersOf } from '@/features/contacts/peers';
import { openChat } from '@/features/navigation/open';

export type ContactSort = 'name' | 'recent';

export interface ContactListProps {
  query: string;
  sortBy: ContactSort;
  /** Opens the sort picker; the caller owns the trigger. */
  sorting: boolean;
  onSort: (sortBy: ContactSort) => void;
  onCloseSort: () => void;
  /** The conversation open beside the list, on layouts that show both. */
  selectedConversationId?: string;
}

let lastKeys: {
  conversations: ChatState['conversations'];
  sessions: ChatState['sessions'];
  byName: boolean;
  keys: string[];
} | null = null;

function peerKeysOf(state: ChatState, byName: boolean): string[] {
  const { conversations, sessions } = state;
  if (
    lastKeys?.conversations === conversations &&
    lastKeys.sessions === sessions &&
    lastKeys.byName === byName
  ) {
    return lastKeys.keys;
  }
  const listed = peersOf(conversations, (protocol) => selfIdFor(state, protocol)).map(peerKey);
  lastKeys = { conversations, sessions, byName, keys: byName ? listed.sort() : listed };
  return lastKeys.keys;
}

/** Everyone you talk to: the Contacts tab on a phone, the sidebar on desktop. */
export function ContactList({
  query,
  sortBy,
  sorting,
  onSort,
  onCloseSort,
  selectedConversationId,
}: ContactListProps) {
  const router = useRouter();
  const colors = useThemeColors();

  const keys = useChatStore(useShallow((s) => peerKeysOf(s, sortBy === 'name')));

  const [access, setAccess] = useState<ContactAccess>('unknown');

  const refreshAccess = () => {
    currentAccess()
      .then(setAccess)
      .catch(() => setAccess('none'));
  };

  useEffect(refreshAccess, [refreshAccess]);

  const peers = keys.map(fromPeerKey);

  const { nameFor } = useDisplayNames(peers);

  const ordered =
    sortBy === 'name'
      ? [...peers].sort((a, b) => nameFor(a.id).localeCompare(nameFor(b.id)))
      : peers;
  const q = query.trim().toLowerCase();
  const visible = q ? ordered.filter((p) => nameFor(p.id).toLowerCase().includes(q)) : ordered;

  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        {access === 'limited' && process.env.EXPO_OS === 'ios' ? (
          <Card className="mx-gutter mb-4 flex-row items-center gap-3">
            <View className="flex-1">
              <Text variant="footnote">
                You have shared only some of your contacts with Status Original.
              </Text>
            </View>
            <Button
              label="Manage"
              size="sm"
              onPress={async () => {
                await manageLimitedAccess();
                refreshAccess();
              }}
            />
          </Card>
        ) : null}

        <Section surface="list">
          <ListItem
            testID="invite-friends"
            title={<Text className="font-semibold text-brand">Invite friends</Text>}
            leading={<Icon name="person-add-outline" size={22} color={colors.brand} />}
            onPress={() => router.push('/invite')}
          />
        </Section>

        <Section title="On Status Original" surface="list" className="mt-6">
          {visible.length === 0 ? (
            <View className="px-gutter py-6">
              <Text variant="footnote">
                {query
                  ? 'Nobody matches that search.'
                  : 'Nobody yet. Start a conversation with an address or an ENS name and they will appear here.'}
              </Text>
            </View>
          ) : (
            visible.map((peer) => (
              <ListItem
                key={`${peer.protocol}-${peer.id}`}
                title={nameFor(peer.id)}
                subtitle={peer.protocol?.toUpperCase()}
                leading={<Avatar seed={nameFor(peer.id)} size="md" />}
                selected={peer.conversationId === selectedConversationId}
                onPress={() => openChat(peer.conversationId)}
              />
            ))
          )}
        </Section>
      </ScrollView>
      <ActionSheet
        visible={sorting}
        onClose={onCloseSort}
        title="Sort by"
        actions={[
          { label: 'Name', selected: sortBy === 'name', onPress: () => onSort('name') },
          {
            label: 'Recently active',
            selected: sortBy === 'recent',
            onPress: () => onSort('recent'),
          },
        ]}
      />
    </>
  );
}
