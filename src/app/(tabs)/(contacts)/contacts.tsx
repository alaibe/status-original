import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';

import { Icon, Pressable, Screen, Text, useThemeColors } from '@/design';
import { ContactList, type ContactSort } from '@/features/contacts/contact-list';

export default function ContactsScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<ContactSort>('name');
  const [sorting, setSorting] = useState(false);

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
        <ContactList
          query={query}
          sortBy={sortBy}
          sorting={sorting}
          onSort={setSortBy}
          onCloseSort={() => setSorting(false)}
        />
      </Screen>
    </>
  );
}
