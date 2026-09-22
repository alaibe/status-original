import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Button, Enter, Glow, Screen, stagger, Text, useThemeColors } from '@/design';
import { hardwareVendors } from '@/core/identity/hardware';
import { isSecureStorageAvailable } from '@/storage/vault';
import { ConnectHardware } from '@/features/identity/connect-hardware';

function AuroraBackdrop() {
  const colors = useThemeColors();
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.set(
      withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.sin) }), -1, true)
    );
  }, [drift]);

  const blobA = useAnimatedStyle(() => ({
    transform: [
      { translateX: -60 + drift.get() * 120 },
      { translateY: -30 + drift.get() * 80 },
      { scale: 1 + drift.get() * 0.25 },
    ],
  }));

  const blobB = useAnimatedStyle(() => ({
    transform: [
      { translateX: 80 - drift.get() * 140 },
      { translateY: 60 - drift.get() * 90 },
      { scale: 1.2 - drift.get() * 0.25 },
    ],
  }));

  return (
    <View style={{ pointerEvents: 'none' }} className="absolute inset-0 overflow-hidden">
      <Animated.View style={blobA} className="absolute -left-24 top-0">
        <Glow size={340} color={colors.brand} />
      </Animated.View>
      <Animated.View style={blobB} className="absolute -right-20 top-40">
        <Glow size={380} color={colors.success} intensity={0.045} />
      </Animated.View>
    </View>
  );
}

export default function Welcome() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  return (
    <Screen className="px-gutter">
      <AuroraBackdrop />

      <View className="flex-1 justify-end gap-3 pb-6">
        <Animated.View entering={Enter.content(stagger(0, 70))}>
          <Text variant="display">Talk freely.</Text>
        </Animated.View>
        <Animated.View entering={Enter.content(stagger(1, 70))}>
          <Text variant="display" className="text-brand">
            Own everything.
          </Text>
        </Animated.View>
        <Animated.View entering={Enter.content(stagger(2, 70))}>
          <Text variant="bodyMuted" className="mt-2 max-w-[420px]">
            End-to-end encrypted messaging with no company in the middle. Your account is a key you
            hold, and it also works as your Ethereum wallet.
          </Text>
        </Animated.View>
      </View>

      <Animated.View entering={Enter.content(stagger(3, 70))} className="gap-3 pb-8">
        {!isSecureStorageAvailable ? (
          <View className="rounded-card border border-warning/40 bg-warning/10 p-3">
            <Text variant="caption" className="text-warning">
              On web, keys are stored in localStorage and are not protected against other scripts.
              Use a device build for a real account.
            </Text>
          </View>
        ) : null}

        <Button
          label="Create an account"
          size="md"
          fullWidth
          onPress={() => router.push('/(onboarding)/create')}
        />
        <Button
          label="I already have a recovery phrase"
          tone="ghost"
          size="md"
          fullWidth
          onPress={() => router.push('/(onboarding)/import')}
        />
        {hardwareVendors().length > 0 ? (
          <Button
            testID="onboarding-hardware"
            label="Connect a hardware wallet"
            tone="ghost"
            size="md"
            fullWidth
            onPress={() => setConnecting(true)}
          />
        ) : null}
        {process.env.EXPO_OS === 'web' ? null : (
          <Text variant="caption" className="mt-1 text-center">
            No phone number or email, so nothing to leak.
          </Text>
        )}
      </Animated.View>

      <ConnectHardware visible={connecting} onClose={() => setConnecting(false)} />
    </Screen>
  );
}
