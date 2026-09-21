import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';

import { Screen } from '@/design';
import { SettingsProfile, useEnsName } from '@/features/settings/settings-profile';
import { SettingsSections, useSettingsKeys } from '@/features/settings/settings-sections';

export default function SettingsScreen() {
  // Bumped on every focus, so keys added on a sub-page show up on the way back.
  const [focusCount, setFocusCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setFocusCount((n) => n + 1);
    }, []),
  );
  const { gifKey, tokenKey } = useSettingsKeys(focusCount);
  const ensName = useEnsName(focusCount);

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Settings', headerTransparent: false }} />

      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <SettingsProfile ensName={ensName} />
        <SettingsSections gifKey={gifKey} tokenKey={tokenKey} />
      </ScrollView>
    </Screen>
  );
}
