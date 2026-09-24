import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import {
  EmptyState,
  Icon,
  ListItem,
  Pressable,
  Screen,
  SearchField,
  Text,
  useThemeColors,
} from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage } from '@/core/messaging/types';
import { contentPreview, formatTimestamp } from '@/core/messaging/preview';
import { useJumpStore } from '@/features/chat/jump-store';
import { openChatFromSheet } from '@/features/navigation/open';
import { errorMessage } from '@/core/errors';

export default function SearchScreen() {
  const router = useRouter();
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const colors = useThemeColors();
  const searchMessages = useChatStore((s) => s.searchMessages);
  const conversations = useChatStore((s) => s.conversations);
  const jumpTo = useJumpStore((s) => s.jumpTo);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; messages: ChatMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchMessages(trimmed, chatId)
        .then((messages) => {
          if (!cancelled) setFound({ query: trimmed, messages });
        })
        .catch((reason) => {
          if (!cancelled) setError(errorMessage(reason, 'Search failed'));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chatId, trimmed, searchMessages]);

  const titles = new Map(conversations.map((c) => [c.id, c.title]));
  const results = trimmed && found?.query === trimmed ? found.messages : [];
  const searching = Boolean(trimmed) && found?.query !== trimmed && !error;

  return (
    <Screen className="px-0" edges={['top']}>
      <View className="flex-row items-center justify-between px-gutter pb-2 pt-4">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={router.back}>
          <Icon name="close" size={24} color={colors['content-muted']} />
        </Pressable>
        <Text className="text-body font-semibold">
          {chatId ? `Search ${titles.get(chatId) ?? 'chat'}` : 'Search messages'}
        </Text>
        <View className="w-6" />
      </View>
      <View className="px-gutter pb-3">
        <SearchField
          autoFocus
          placeholder="Search messages"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setError(null);
          }}
          onClear={() => {
            setQuery('');
            setError(null);
          }}
        />
      </View>
      {error ? <Text className="px-gutter text-danger">{error}</Text> : null}
      {searching ? <Text className="px-gutter py-2">Searching…</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(message) => `${message.conversationId}:${message.id}`}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          trimmed && !searching && !error ? (
            <EmptyState
              icon={<Icon name="search-outline" size={40} color={colors['content-subtle']} />}
              title="No messages found"
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ListItem
            title={titles.get(item.conversationId) ?? 'Chat'}
            meta={formatTimestamp(item.sentAt)}
            subtitle={contentPreview(item.content)}
            numberOfLinesSubtitle={3}
            onPress={() => {
              jumpTo(item);
              openChatFromSheet(item.conversationId);
            }}
          />
        )}
      />
    </Screen>
  );
}
