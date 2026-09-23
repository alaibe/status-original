import { useRouter } from 'expo-router';
import { Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Card, copyText, Icon, Pressable, Screen, Text, useThemeColors } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { shortAddress } from '@/core/identity/keyring';

export default function QrScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const keyring = useIdentityStore((s) => s.keyring);
  const accounts = useIdentityStore((s) => s.accounts);
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);

  const label = accounts.find((a) => a.id === activeAccountId)?.label ?? 'Your account';

  if (!keyring) {
    return (
      <Screen className="items-center justify-center">
        <Text variant="footnote">No account is open.</Text>
      </Screen>
    );
  }

  return (
    <Screen className="justify-between px-gutter py-4" edges={['top', 'bottom']}>
      <View className="flex-row justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}>
          <Icon name="close" size={26} color={colors['content-muted']} />
        </Pressable>
      </View>

      <View className="items-center gap-6">
        <Card className="items-center gap-4 p-6">
          <View className="rounded-card bg-white p-4">
            <QRCode value={keyring.address} size={220} backgroundColor="#ffffff" color="#000000" />
          </View>
          <View className="items-center gap-1">
            <Text className="font-semibold">{label}</Text>
            <Text variant="mono" selectable>
              {shortAddress(keyring.address, 12, 10)}
            </Text>
          </View>
        </Card>

        <Text variant="footnote" className="text-center">
          Anyone who scans this can start a conversation with you. It is your public address, so
          sharing it reveals nothing that is not already public on-chain.
        </Text>
      </View>

      <View className="gap-2">
        {process.env.EXPO_OS === 'web' ? null : (
          <Button
            label="Share address"
            fullWidth
            onPress={() => {
              Share.share({ message: keyring.address }).catch(() => {});
            }}
          />
        )}
        <Button
          label="Copy address"
          tone="neutral"
          fullWidth
          onPress={() => void copyText(keyring.address, 'Address copied')}
        />
      </View>
    </Screen>
  );
}
