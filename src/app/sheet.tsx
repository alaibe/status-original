import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Text } from '@/design';
import { SHEET_DISMISS_MS, useSheetStore } from '@/design/components/sheet';

export default function SheetRoute() {
  const current = useSheetStore((s) => s.current);
  const insets = useSafeAreaInsets();

  // Unmounting is how a swipe-to-dismiss reaches the owner.
  useEffect(
    () => () => {
      const { current: closing, afterClose } = useSheetStore.getState();
      useSheetStore.setState({ current: null, afterClose: null });
      closing?.onClose();
      if (afterClose) setTimeout(afterClose, SHEET_DISMISS_MS);
    },
    []
  );

  return (
    <View className="bg-surface px-gutter" style={{ paddingBottom: insets.bottom + 8 }}>
      <View className="min-h-tap flex-row items-center gap-3 py-3">
        {current?.leading}
        <View className="min-w-0 flex-1">
          {current?.title ? (
            <Text variant="title" numberOfLines={1}>
              {current.title}
            </Text>
          ) : null}
          {current?.subtitle ? (
            <Text variant="caption" numberOfLines={1}>
              {current.subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton
          testID="sheet-close"
          icon="close"
          label="Close"
          size={18}
          className="bg-surface-sunken"
          onPress={() => current?.onClose()}
        />
      </View>
      <View className="gap-3">{current?.children}</View>
    </View>
  );
}
