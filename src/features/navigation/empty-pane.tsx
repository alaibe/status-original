import { View } from 'react-native';

import { Text } from '@/design';

/** What the desktop pane shows while nothing from the sidebar is open. */
export function EmptyPane({ hint }: { hint: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <View className="rounded-pill bg-surface-sunken px-4 py-2">
        <Text variant="footnote">{hint}</Text>
      </View>
    </View>
  );
}
