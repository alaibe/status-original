import { useRouter } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';

import { useEscapeKey } from '@/design';

/**
 * A route shown over the pane as a centred card. The backdrop and Esc go back,
 * which is what a phone's swipe-down does.
 */
export function Dialog({ children }: PropsWithChildren) {
  const router = useRouter();
  useEscapeKey(true, () => router.back());

  return (
    <View className="flex-1 items-center justify-center p-6">
      <Pressable
        accessibilityLabel="Close"
        onPress={() => router.back()}
        className="absolute inset-0 bg-content/30"
      />
      <View
        style={{ borderCurve: 'continuous' }}
        className="max-h-full w-[560px] max-w-full overflow-hidden rounded-card bg-canvas shadow-xl">
        {children}
      </View>
    </View>
  );
}
