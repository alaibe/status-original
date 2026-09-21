import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text as NativeText,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import emojiData from 'rn-emoji-keyboard/src/assets/emojis.json';

import { Icon, SearchField, Text, useThemeColors, type IconName } from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';


interface EmojiEntry {
  emoji: string;
  name: string;
  keywords?: string[];
}

interface Category {
  id: string;
  title: string;
  icon: IconName;
  emojis: string[];
}

type Row =
  | { kind: 'header'; title: string; category: string }
  | { kind: 'emoji'; emojis: string[] };

const CATEGORY_META: Record<string, { title: string; icon: IconName }> = {
  smileys_emotion: { title: 'Smileys & Emotion', icon: 'happy-outline' },
  people_body: { title: 'People & Body', icon: 'hand-left-outline' },
  animals_nature: { title: 'Animals & Nature', icon: 'leaf-outline' },
  food_drink: { title: 'Food & Drink', icon: 'pizza-outline' },
  travel_places: { title: 'Travel & Places', icon: 'airplane-outline' },
  activities: { title: 'Activities', icon: 'football-outline' },
  objects: { title: 'Objects', icon: 'bulb-outline' },
  symbols: { title: 'Symbols', icon: 'shapes-outline' },
  flags: { title: 'Flags', icon: 'flag-outline' },
};

const RECENT = 'recent';
const RECENT_KEY = 'chat.recentEmoji';
const RECENT_LIMIT = 32;

const GROUPS = (emojiData as { title: string; data: EmojiEntry[] }[]).filter(
  (group) => group.title in CATEGORY_META
);

const CATEGORIES: Category[] = GROUPS.map((group) => ({
  id: group.title,
  ...CATEGORY_META[group.title],
  emojis: group.data.map((entry) => entry.emoji),
}));

const SEARCHABLE: { emoji: string; text: string }[] = GROUPS.flatMap((group) =>
  group.data.map((entry) => ({
    emoji: entry.emoji,
    text: [entry.name, ...(entry.keywords ?? [])].join(' ').replace(/_/g, ' '),
  }))
);

const PAD = 8;
const CELL = 40;
const HEADER = 30;
const EMOJI_SIZE = 26;

function chunk(emojis: string[], columns: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < emojis.length; i += columns) rows.push(emojis.slice(i, i + columns));
  return rows;
}

export function searchEmoji(query: string, limit = 120): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const found: string[] = [];
  for (const entry of SEARCHABLE) {
    if (terms.every((term) => entry.text.includes(term))) {
      found.push(entry.emoji);
      if (found.length >= limit) break;
    }
  }
  return found;
}

export interface EmojiGridProps {
  width: number;
  onEmoji(emoji: string): void;
  autoFocusSearch?: boolean;
}

export function EmojiGrid({ width, onEmoji, autoFocusSearch }: EmojiGridProps) {
  const colors = useThemeColors();
  const storage = useChatStore((s) => s.accountStorage);
  const list = useRef<FlatList<Row>>(null);

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState<string>(CATEGORIES[0].id);

  useEffect(() => {
    if (!storage) return;
    let cancelled = false;
    storage
      .get<string[]>(RECENT_KEY)
      .then((saved) => {
        if (!cancelled && Array.isArray(saved)) setRecent(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const columns = Math.max(4, Math.floor((width - PAD * 2) / CELL));
  const cell = (width - PAD * 2) / columns;

  const trimmed = query.trim();

  const { rows, offsets, sections } = useMemo(() => {
    const built: Row[] = [];
    const starts: { category: string; offset: number }[] = [];
    if (trimmed) {
      for (const group of chunk(searchEmoji(trimmed), columns)) built.push({ kind: 'emoji', emojis: group });
    } else {
      const groups: { id: string; title: string; emojis: string[] }[] = [];
      if (recent.length > 0) groups.push({ id: RECENT, title: 'Recently used', emojis: recent });
      for (const category of CATEGORIES) groups.push(category);
      for (const group of groups) {
        built.push({ kind: 'header', title: group.title, category: group.id });
        for (const line of chunk(group.emojis, columns)) built.push({ kind: 'emoji', emojis: line });
      }
    }
    const positions: number[] = [];
    let y = 0;
    for (const row of built) {
      positions.push(y);
      if (row.kind === 'header') starts.push({ category: row.category, offset: y });
      y += row.kind === 'header' ? HEADER : CELL;
    }
    return { rows: built, offsets: positions, sections: starts };
  }, [trimmed, recent, columns]);

  const pick = useCallback(
    (emoji: string) => {
      onEmoji(emoji);
      setRecent((current) => {
        const next = [emoji, ...current.filter((e) => e !== emoji)].slice(0, RECENT_LIMIT);
        storage?.set(RECENT_KEY, next).catch(() => {});
        return next;
      });
    },
    [onEmoji, storage]
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y + 1;
      let current = sections[0]?.category ?? CATEGORIES[0].id;
      for (const section of sections) {
        if (section.offset <= y) current = section.category;
        else break;
      }
      setActive((previous) => (previous === current ? previous : current));
    },
    [sections]
  );

  const jumpTo = (category: string) => {
    const section = sections.find((s) => s.category === category);
    if (!section) return;
    setActive(category);
    list.current?.scrollToOffset({ offset: section.offset, animated: true });
  };

  const renderItem = ({ item }: ListRenderItemInfo<Row>) => {
    if (item.kind === 'header') {
      return (
        <View style={{ height: HEADER, paddingHorizontal: PAD + 4 }} className="justify-end pb-1">
          <Text variant="caption" className="font-semibold text-content-muted">
            {item.title}
          </Text>
        </View>
      );
    }
    return (
      <View style={{ height: CELL, paddingHorizontal: PAD }} className="flex-row">
        {item.emojis.map((emoji, index) => (
          <Pressable
            key={`${emoji}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={emoji}
            onPress={() => pick(emoji)}
            style={{ width: cell, height: CELL }}
            className="items-center justify-center rounded-md hover:bg-surface-sunken active:bg-surface-sunken">
            <NativeText allowFontScaling={false} style={{ fontSize: EMOJI_SIZE, lineHeight: CELL - 4 }}>
              {emoji}
            </NativeText>
          </Pressable>
        ))}
      </View>
    );
  };

  const tabs = recent.length > 0 && !trimmed
    ? [{ id: RECENT, title: 'Recently used', icon: 'time-outline' as IconName }, ...CATEGORIES]
    : CATEGORIES;

  return (
    <View className="flex-1">
      <SearchField
        className="mx-3 mb-2 mt-3"
        placeholder="Search emoji"
        autoFocus={autoFocusSearch}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => {
          const first = trimmed ? searchEmoji(trimmed, 1)[0] : undefined;
          if (first) pick(first);
        }}
      />

      {rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="footnote" className="text-center">
            No emoji match “{trimmed}”.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={list}
          data={rows}
          renderItem={renderItem}
          keyExtractor={(_, index) => String(index)}
          getItemLayout={(_, index) => ({
            length: rows[index].kind === 'header' ? HEADER : CELL,
            offset: offsets[index],
            index,
          })}
          onScroll={onScroll}
          scrollEventThrottle={32}
          initialNumToRender={14}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: PAD }}
        />
      )}

      <View className="flex-row items-center border-t border-line px-2 py-1">
        {tabs.map((category) => {
          const selected = !trimmed && category.id === active;
          return (
            <Pressable
              key={category.id}
              accessibilityRole="tab"
              accessibilityLabel={category.title}
              accessibilityState={{ selected }}
              onPress={() => jumpTo(category.id)}
              className={
                selected
                  ? 'h-8 flex-1 items-center justify-center rounded-md bg-brand-soft'
                  : 'h-8 flex-1 items-center justify-center rounded-md hover:bg-surface-sunken'
              }>
              <Icon
                name={category.icon}
                size={20}
                color={selected ? colors.brand : colors['content-muted']}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
