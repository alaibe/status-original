import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { botIdFromConversation, isLocalConversation } from '@/core/messaging/bots';
import { useChatStore } from '@/core/messaging/chat-store';
import type { Conversation, ConversationId, MessageId } from '@/core/messaging/types';
import { Icon, IconButton, Pressable, Text, useLayoutInsets, useThemeColors } from '@/design';
import { ConversationAvatar } from './conversation-avatar';
import { headerSubtitle } from './header-subtitle';

interface ConversationHeaderProps {
  id: ConversationId;
  thread?: MessageId;
  conversation?: Conversation;
  selfId: string;
  chatTitle: string;
  onBack(): void;
}

export function ConversationHeader({
  id,
  thread,
  conversation,
  selfId,
  chatTitle,
  onBack,
}: ConversationHeaderProps) {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const frame = useLayoutInsets();
  const desktop = process.env.EXPO_OS === 'web';
  const isBot = isLocalConversation(id);
  const botTagline = useChatStore((s) =>
    isBot ? s.bots[botIdFromConversation(id)]?.tagline : undefined
  );
  const title = thread ? 'Thread' : chatTitle;

  return (
    <View
      className="absolute left-0 right-0 top-0 z-10 flex-row items-center gap-2 px-3"
      style={{ paddingTop: insets.top + frame.top + 6, paddingBottom: 8 }}>
      {desktop ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          className="h-10 w-10 items-center justify-center overflow-hidden rounded-pill">
          <BlurView
            intensity={40}
            tint={colors.scheme === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View className="absolute inset-0 bg-canvas/55" />
          <Icon name="chevron-back" size={22} color={colors.brand} />
        </Pressable>
      )}

      <Pressable
        // Pressable merges its children into one accessibility element.
        testID={`chat-header-${id}`}
        accessibilityRole="button"
        accessibilityLabel={thread ? `Thread in ${chatTitle}` : `${title}. Conversation details`}
        disabled={isBot || !!thread}
        onPress={() => router.push(`/profile/${id}`)}
        className="flex-1 items-center">
        <View className="max-w-full overflow-hidden rounded-pill px-4 py-1.5">
          <BlurView
            intensity={40}
            tint={colors.scheme === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View className="absolute inset-0 bg-canvas/55" />
          <Text className="text-center font-semibold" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="micro" numberOfLines={1} className="text-center">
            {thread
              ? chatTitle
              : isBot
                ? (botTagline ?? 'On this device only')
                : headerSubtitle(conversation)}
          </Text>
        </View>
      </Pressable>

      {thread ? (
        desktop ? (
          <IconButton icon="close" label="Close thread" tone="brand" size={20} onPress={onBack} />
        ) : (
          <View className="h-10 w-10" />
        )
      ) : conversation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search in chat"
          onPress={() => router.push(`/search?chatId=${encodeURIComponent(id)}`)}
          className="h-10 w-10 items-center justify-center">
          <Icon name="search-outline" size={20} color={colors.brand} />
        </Pressable>
      ) : null}

      {thread ? null : conversation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Conversation details"
          disabled={isBot}
          onPress={() => router.push(`/profile/${id}`)}>
          <ConversationAvatar conversation={conversation} selfId={selfId} size="md" />
        </Pressable>
      ) : (
        <View className="h-10 w-10" />
      )}
    </View>
  );
}
