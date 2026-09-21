import { View } from 'react-native';

import { Text } from '@/design';

/** A desktop page in the pane: a card with its title, in place of a navigation header. */
export function PaneCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View
      style={{ borderCurve: 'continuous' }}
      className="m-2 flex-1 overflow-hidden rounded-card bg-surface shadow-md">
      {title ? (
        <View className="border-b border-line bg-surface-raised px-5 py-3.5">
          <Text variant="title" className="font-semibold">
            {title}
          </Text>
        </View>
      ) : null}
      <View className="flex-1">{children}</View>
    </View>
  );
}
