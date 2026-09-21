import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { IconButton, Screen } from '@/design';
import { ChatList } from '@/features/chat/chat-list';

export default function ChatsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen
        options={{
          title: 'Chats',
          headerRight: () => (
            <View className="flex-row items-center gap-1">
              <IconButton
                testID="header-new-group"
                icon="people-outline"
                label="New group"
                onPress={() => router.push('/new-chat?mode=group')}
              />
              <IconButton
                testID="header-new-conversation"
                icon="create-outline"
                label="New message"
                tone="brand"
                onPress={() => router.push('/new-chat')}
              />
            </View>
          ),
        }}
      />
      <Stack.SearchBar
        placeholder="Search chats"
        hideWhenScrolling
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
      />

      <ChatList query={query} />
    </Screen>
  );
}
