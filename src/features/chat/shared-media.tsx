import { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

import { Icon, ListItem, Pressable, Text, type IconName, useThemeColors } from '@/design';
import { isLocalConversation } from '@/core/messaging/bots';
import { useChatStore } from '@/core/messaging/chat-store';
import {
  countsFor,
  entriesOf,
  type MediaCategory,
  type MediaEntry,
} from '@/core/messaging/media-index';
import { formatDayLabel } from '@/core/messaging/preview';
import { openInBrowser } from '@/lib/open-url';

const TABS: { id: MediaCategory; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'files', label: 'Files' },
  { id: 'voice', label: 'Voice' },
  { id: 'links', label: 'Links' },
  { id: 'gifs', label: 'GIFs' },
];

export function SharedMedia({ conversationId }: { conversationId: string }) {
  const [tab, setTab] = useState<MediaCategory>('media');
  const { width } = useWindowDimensions();
  const mediaIndex = useChatStore((s) => s.mediaIndex);
  const counts = countsFor(mediaIndex, conversationId);
  const entries = entriesOf(mediaIndex, conversationId, tab);
  const cell = Math.floor((Math.min(width, 720) - 4 * 2) / 3) - 2;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-gutter pb-3">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.label}, ${counts[entry.id]}`}
              onPress={() => setTab(entry.id)}
              className={
                active
                  ? 'flex-row items-center gap-1.5 rounded-pill bg-brand px-3 py-1.5'
                  : 'flex-row items-center gap-1.5 rounded-pill bg-surface-sunken px-3 py-1.5'
              }>
              <Text
                variant="caption"
                className={active ? 'font-semibold text-brand-on' : 'font-medium text-content'}>
                {entry.label}
              </Text>
              <Text variant="micro" className={active ? 'text-brand-on/80' : 'text-content-subtle'}>
                {counts[entry.id]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {entries.length === 0 ? (
        <Text variant="footnote" className="px-gutter py-6">
          {isLocalConversation(conversationId)
            ? 'Bot conversations do not share files.'
            : `Nothing shared in this conversation yet.`}
        </Text>
      ) : tab === 'media' || tab === 'gifs' ? (
        <View className="flex-row flex-wrap gap-0.5 px-1">
          {entries.map((entry) => (
            <Image
              key={`${entry.messageId}-${entry.uri}`}
              source={{ uri: entry.uri }}
              style={{ width: cell, height: cell }}
              contentFit="cover"
            />
          ))}
        </View>
      ) : (
        entries.map((entry) => (
          <MediaRow key={`${entry.messageId}-${entry.uri}`} entry={entry} category={tab} />
        ))
      )}
    </>
  );
}

function MediaRow({ entry, category }: { entry: MediaEntry; category: MediaCategory }) {
  const colors = useThemeColors();
  const icon: IconName =
    category === 'voice'
      ? 'mic-outline'
      : category === 'links'
        ? 'link-outline'
        : 'document-outline';

  return (
    <ListItem
      title={entry.label ?? entry.uri}
      subtitle={formatDayLabel(entry.sentAt)}
      leading={<Icon name={icon} size={20} color={colors['content-muted']} />}
      onPress={() => {
        openInBrowser(entry.uri).catch(() => {});
      }}
    />
  );
}
