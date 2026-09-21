import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn, Text } from '@/design';
import { useSheetStore } from '@/design/components/sheet';

export default function SheetRoute() {
  const current = useSheetStore((s) => s.current);
  const insets = useSafeAreaInsets();

  // Swiping the sheet away unmounts this route; the owner learns about it here.
  useEffect(
    () => () => {
      const closing = useSheetStore.getState().current;
      useSheetStore.setState({ current: null });
      closing?.onClose();
    },
    []
  );

  return (
    <View
      className={cn('bg-surface-raised px-gutter pt-4', current?.className)}
      style={{ paddingBottom: insets.bottom + 16 }}>
      {current?.title ? (
        <Text variant="title" className="mb-3">
          {current.title}
        </Text>
      ) : null}
      {current?.children}
    </View>
  );
}
