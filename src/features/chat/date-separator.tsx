import { View } from 'react-native';

import { Text } from '@/design';
import { formatDayLabel } from '@/core/messaging/preview';

export function DateSeparator({ at }: { at: number }) {
  return (
    <View className="items-center py-2">
      <View className="rounded-pill bg-surface-sunken/90 px-2.5 py-1">
        <Text variant="micro" className="font-medium text-content-muted">
          {formatDayLabel(at)}
        </Text>
      </View>
    </View>
  );
}
