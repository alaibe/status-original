import { Stack } from 'expo-router';

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Card, copyText, Enter, Icon, Pressable, Screen, Text, useThemeColors } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { shortAddress } from '@/core/identity/keyring';
import { RecoveryPhrase } from '@/features/identity/recovery-phrase';

export default function IdentityScreen() {
  const colors = useThemeColors();

  const keyring = useIdentityStore((s) => s.keyring);

  const [revealed, setRevealed] = useState(false);

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Recovery phrase' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 140 }}>
        <View className="gap-4 px-gutter">
          <Card className="gap-2">
            <Text variant="caption">Address</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy address"
              onPress={async () => {
                if (!keyring) return;
                await copyText(keyring.address, 'Address copied');
              }}
              pressScale={0.99}
              className="flex-row items-center justify-between">
              <Text variant="mono">{keyring ? shortAddress(keyring.address, 12, 10) : '—'}</Text>
              <Icon name="copy-outline" size={16} color={colors['content-muted']} />
            </Pressable>
          </Card>

          <View className="rounded-card border border-danger/40 bg-danger/10 p-3">
            <Text variant="caption" className="text-danger">
              Anyone with these words controls your messages and any funds at this address. Never
              type them into a website or share them with support.
            </Text>
          </View>

          <Card className="gap-3">
            {revealed ? (
              <Animated.View entering={Enter.fade()}>
                <RecoveryPhrase phrase={keyring?.mnemonic ?? ''} />
              </Animated.View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setRevealed(true)}
                className="items-center justify-center gap-1.5 rounded-field bg-surface-sunken py-10">
                <Icon name="eye-outline" size={20} color={colors['content-muted']} />
                <Text variant="title">Tap to reveal</Text>
              </Pressable>
            )}
          </Card>

          <Text variant="caption">
            To remove this account from the device, use Erase this account in Settings.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
