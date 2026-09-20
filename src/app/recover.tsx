import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Icon, Screen, Text, useThemeColors } from '@/design';
import { eraseAllAccounts } from '@/core/app/erase-account';
import { useIdentityStore } from '@/core/identity/identity-store';
import { shortAddress } from '@/core/identity/keyring';

export default function RecoverScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const accounts = useIdentityStore((s) => s.accounts);
  const [erasing, setErasing] = useState(false);

  return (
    <Screen className="justify-center gap-6 px-gutter">
      <View className="items-center gap-3">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-surface-sunken">
          <Icon name="key-outline" size={34} color={colors.danger} />
        </View>
        <Text variant="headline" className="text-center">
          Your keys need re-importing
        </Text>
      </View>

      <Text variant="bodyMuted">
        This device&apos;s biometrics changed, so iOS discarded the keys that were sealed to them.
        That is the trade-off of protecting keys with Face ID, and it cannot be undone from here.
      </Text>

      <Card className="gap-2">
        <Text variant="caption">Affected</Text>
        {accounts.map((account) => (
          <Text key={account.id} variant="mono">
            {account.label} · {shortAddress(account.address, 8, 6)}
          </Text>
        ))}
      </Card>

      <Text variant="bodyMuted">
        Your messages and settings are still here. Import an account&apos;s recovery phrase and it
        picks up exactly where it left off.
      </Text>

      <View className="gap-2">
        <Button
          label="Import a recovery phrase"
          fullWidth
          onPress={() => router.push('/(onboarding)/import')}
        />
        <Button
          label={erasing ? 'Erasing…' : 'Erase everything and start over'}
          tone="danger"
          fullWidth
          disabled={erasing}
          onPress={async () => {
            setErasing(true);
            try {
              await eraseAllAccounts();
              router.replace('/(onboarding)/welcome');
            } finally {
              setErasing(false);
            }
          }}
        />
      </View>
    </Screen>
  );
}
