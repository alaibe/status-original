import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Pressable, SearchField, Text } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import type { MessageContent } from '@/core/messaging/types';
import { errorMessage } from '@/core/errors';

import { featuredGifs, gifToContent, loadGifKey, searchGifs, type Gif } from './attachments/gifs';
import { EmojiGrid } from './emoji-grid';

export type MediaTab = 'emoji' | 'gifs';

export interface MediaAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaPanelProps {
  tab: MediaTab;
  /** Where the button that opened it sits; the desktop docks the panel to it. */
  anchor?: MediaAnchor | null;
  onClose(): void;
  onEmoji(emoji: string): void;
  onGif(content: MessageContent): void;
}

export interface MediaPanelContentProps {
  tab: MediaTab;
  onTab(tab: MediaTab): void;
  onEmoji(emoji: string): void;
  onGif(content: MessageContent): void;
  /** A popover has the keyboard already; a bottom sheet would raise it over itself. */
  autoFocusSearch?: boolean;
}

const GIF_COLUMNS = 3;
const GIF_GAP = 4;
const SEARCH_DEBOUNCE_MS = 350;

export function MediaPanelContent({ tab, onTab, onEmoji, onGif, autoFocusSearch }: MediaPanelContentProps) {
  const [width, setWidth] = useState(0);

  return (
    <View className="flex-1" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View className="flex-1">
        {width === 0 ? null : tab === 'emoji' ? (
          <EmojiGrid width={width} onEmoji={onEmoji} autoFocusSearch={autoFocusSearch} />
        ) : (
          <GifGrid width={width} onGif={onGif} autoFocusSearch={autoFocusSearch} />
        )}
      </View>

      <View className="flex-row items-center justify-center gap-1 border-t border-line px-3 py-2">
        {(['emoji', 'gifs'] as const).map((entry) => {
          const active = entry === tab;
          return (
            <Pressable
              key={entry}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onTab(entry)}
              className={active ? 'rounded-pill bg-surface-sunken px-4 py-1.5' : 'rounded-pill px-4 py-1.5'}>
              <Text className={active ? 'font-semibold text-content' : 'font-medium text-content-muted'}>
                {entry === 'emoji' ? 'Emoji' : 'GIFs'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function GifGrid({
  width,
  onGif,
  autoFocusSearch,
}: {
  width: number;
  onGif(content: MessageContent): void;
  autoFocusSearch?: boolean;
}) {
  const accountId = useIdentityStore((s) => s.activeAccountId);

  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Gif[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    loadGifKey(accountId)
      .then((value) => {
        if (!cancelled) setKey(value);
      })
      .catch(() => {
        if (!cancelled) setKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const found = trimmed ? await searchGifs(key, trimmed) : await featuredGifs(key);
        if (!cancelled) setResults(found);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, 'Could not load GIFs'));
      }
      if (!cancelled) setBusy(false);
    }, trimmed ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, query]);

  if (key === null) {
    return (
      <View className="gap-3 px-4 py-4">
        <Text variant="footnote">
          GIF search needs a Tenor key, which you add in Settings. There is no free keyless GIF
          API, and this app does not ship credentials of its own.
        </Text>
        <Text variant="footnote">
          You can still send GIFs without one: pick them from your photo library like any other
          image and they send animated.
        </Text>
      </View>
    );
  }

  const tile = Math.floor((width - 24 - GIF_GAP * (GIF_COLUMNS - 1)) / GIF_COLUMNS);

  return (
    <View className="flex-1">
      <SearchField
        className="mx-3 mb-2 mt-3"
        placeholder="Search GIFs"
        autoFocus={autoFocusSearch}
        value={query}
        onChangeText={setQuery}
      />

      {error ? (
        <Text variant="caption" className="px-4 pb-2 text-danger">
          {error}
        </Text>
      ) : null}

      {busy && results.length === 0 ? (
        <View className="flex-1 items-center justify-center py-8">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="flex-row flex-wrap px-3 pb-3"
          contentContainerStyle={{ gap: GIF_GAP }}
          keyboardShouldPersistTaps="handled">
          {results.map((gif) => (
            <Pressable
              key={gif.id}
              accessibilityRole="button"
              accessibilityLabel={gif.description}
              onPress={async () => {
                if (!accountId) return;
                try {
                  onGif(await gifToContent(accountId, gif));
                } catch (e) {
                  setError(errorMessage(e, 'Could not send that GIF'));
                }
              }}>
              <Image
                source={{ uri: gif.previewUrl }}
                style={{ width: tile, height: tile, borderRadius: 8 }}
                contentFit="cover"
              />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
