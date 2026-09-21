import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  ActionSheet,
  Avatar,
  Button,
  Card,
  Icon,
  ListItem,
  Pressable,
  Screen,
  Section,
  Text,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import { useDisplayNames } from '@/features/chat/use-display-names';
import { currentAccess, manageLimitedAccess, type ContactAccess } from '@/features/contacts/device-contacts';
import { peersOf } from '@/features/contacts/peers';

export default function ContactsScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const conversations = useChatStore((s) => s.conversations);
  const sessions = useChatStore((s) => s.sessions);

  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'recent'>('name');
  const [sorting, setSorting] = useState(false);
  const [access, setAccess] = useState<ContactAccess>('unknown');

  const refreshAccess = () => {
    currentAccess().then(setAccess).catch(() => setAccess('none'));
  };

  useEffect(refreshAccess, [refreshAccess]);

  const peers = peersOf(conversations, (protocol) => selfIdFor({ sessions }, protocol));

  const { nameFor } = useDisplayNames(peers);

  const ordered =
    sortBy === 'name'
      ? [...peers].sort((a, b) => nameFor(a.id).localeCompare(nameFor(b.id)))
      : peers;
  const q = query.trim().toLowerCase();
  const visible = q ? ordered.filter((p) => nameFor(p.id).toLowerCase().includes(q)) : ordered;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Contacts',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort contacts"
              onPress={() => setSorting(true)}>
              <Text className="font-medium text-brand">Sort</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              onPress={() => router.push('/new-chat')}>
              <Icon name="add" size={24} color={colors.brand} />
            </Pressable>
          ),
        }}
      />
      <Stack.SearchBar
        placeholder="Search"
        hideWhenScrolling={false}
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
      />

      <Screen className="px-0" edges={[]}>
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
                  onPress={() => router.push(`/chat/${peer.conversationId}`)}
                />
              ))
            )}
          </Section>
        </ScrollView>
        <ActionSheet
          visible={sorting}
          onClose={() => setSorting(false)}
          title="Sort by"
          actions={[
            { label: sortBy === 'name' ? 'Name \u2713' : 'Name', onPress: () => setSortBy('name') },
            {
              label: sortBy === 'recent' ? 'Recently active \u2713' : 'Recently active',
              onPress: () => setSortBy('recent'),
            },
          ]}
        />
      </Screen>
    </>
  );
}
