import { View } from 'react-native';

import { cn, Icon, Pressable, Text, useThemeColors } from '@/design';
import { coordinatesLabel, type Location } from '@/core/messaging/locations';
import { openInMaps } from './message-text';

export function LocationCard({ location, fromMe }: { location: Location; fromMe: boolean }) {
  const colors = useThemeColors();
  const coordinates = coordinatesLabel(location);
  const title = location.label ?? coordinates ?? 'Shared place';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}. Open in Maps`}
      onPress={() => {
        openInMaps(location.url).catch(() => {});
      }}
      className={cn(
        'mt-1.5 flex-row items-center gap-2.5 rounded-md px-2 py-1.5',
        fromMe ? 'bg-bubble-out-on/15' : 'bg-content/5'
      )}
      style={{ borderCurve: 'continuous' }}>
      <Icon
        name="location-outline"
        size={22}
        color={fromMe ? colors['bubble-out-on'] : colors.brand}
      />
      <View className="min-w-0 flex-1">
        <Text
          variant="footnote"
          numberOfLines={2}
          className={cn('font-semibold', fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on')}>
          {title}
        </Text>
        <Text
          variant="caption"
          numberOfLines={1}
          className={fromMe ? 'text-bubble-out-on/80' : undefined}>
          {location.label && coordinates ? `${coordinates} · Open in Maps` : 'Open in Maps'}
        </Text>
      </View>
    </Pressable>
  );
}
