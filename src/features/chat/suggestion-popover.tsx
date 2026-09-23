import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import Animated from 'react-native-reanimated';

import { Enter, Exit, Pressable } from '@/design';

export function SuggestionPopover<T>({
  items,
  keyOf,
  onPick,
  render,
  testID,
  itemTestID,
  labelOf,
}: {
  items: T[];
  keyOf: (item: T) => string;
  onPick: (item: T) => void;
  render: (item: T) => ReactNode;
  testID?: string;
  itemTestID?: (item: T) => string;
  labelOf?: (item: T) => string;
}) {
  if (items.length === 0) return null;
  return (
    <Animated.View
      entering={Enter.fade()}
      exiting={Exit.fade()}
      className="mx-gutter mb-2 overflow-hidden rounded-card border border-line bg-surface-raised">
      <ScrollView
        testID={testID}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        className="max-h-64">
        {items.map((item) => (
          <Pressable
            key={keyOf(item)}
            testID={itemTestID?.(item)}
            accessibilityRole="button"
            accessibilityLabel={labelOf?.(item)}
            onPress={() => onPick(item)}
            pressScale={1}
            className="flex-row items-baseline gap-2 border-b border-line px-3 py-2.5 last:border-b-0 active:bg-surface">
            {render(item)}
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}
