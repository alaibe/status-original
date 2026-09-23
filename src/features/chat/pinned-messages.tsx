import { ScrollView, View } from 'react-native';

import { Button, Icon, Pressable, Sheet, Text, useThemeColors } from '@/design';
import { contentPreview, formatTimestamp } from '@/core/messaging/preview';
import type { ChatMessage } from '@/core/messaging/types';

export function PinnedMessages({
  messages,
  visible,
  onOpen,
  onClose,
  onUnpin,
  top,
}: {
  messages: ChatMessage[];
  visible: boolean;
  onOpen(): void;
  onClose(): void;
  onUnpin(message: ChatMessage): void;
  top: number;
}) {
  const colors = useThemeColors();
  const newest = messages[0];
  if (!newest) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${messages.length} pinned messages`}
        onPress={onOpen}
        style={{ top }}
        className="absolute left-3 right-3 z-[9] flex-row items-center gap-2 rounded-card border border-line bg-surface-raised px-3 py-2 shadow-sm">
        <Icon name="pin-outline" size={17} color={colors.brand} />
        <View className="min-w-0 flex-1">
          <Text variant="micro" className="font-semibold text-brand">
            {messages.length === 1 ? 'Pinned message' : `${messages.length} pinned messages`}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {contentPreview(newest.content)}
          </Text>
        </View>
        <Icon name="chevron-forward" size={16} color={colors['content-subtle']} />
      </Pressable>
      <Sheet visible={visible} onClose={onClose} title="Pinned messages">
        <ScrollView className="max-h-[480px]">
          {messages.map((message) => (
            <View key={message.id} className="gap-1 border-b border-line px-4 py-3">
              <Text variant="micro">{formatTimestamp(message.sentAt)}</Text>
              <Text selectable>
                {message.content.kind === 'text'
                  ? message.content.text
                  : contentPreview(message.content)}
              </Text>
              <Button
                label="Unpin"
                tone="ghost"
                size="sm"
                onPress={() => onUnpin(message)}
                className="self-start"
              />
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}
