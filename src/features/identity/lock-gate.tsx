import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import { Button, Icon, Screen, Text, useThemeColors } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { isKeyProtectionEnabled } from '@/core/identity/key-protection';
import { biometricCapability } from '@/core/identity/lock';
import { useLockStore } from '@/core/identity/lock-store';

export function LockGate() {
  const colors = useThemeColors();
  const prompting = useLockStore((s) => s.prompting);
  const unlock = useLockStore((s) => s.unlock);
  const open = useLockStore((s) => s.noteJustAuthenticated);

  const identityStatus = useIdentityStore((s) => s.status);
  const retryUnlock = useIdentityStore((s) => s.retryUnlock);

  const [label, setLabel] = useState('Face ID');
  const [protectedKeys, setProtectedKeys] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    biometricCapability().then((c) => setLabel(c.label));
    isKeyProtectionEnabled().then(setProtectedKeys);
  }, []);

  const attempt = useCallback(async () => {
    if (protectedKeys === null) return;
    setFailed(false);

    if (protectedKeys) {
      const passed = await retryUnlock();
      if (!passed) setFailed(true);
      return;
    }

    const passed = await unlock();
    if (!passed) setFailed(true);
  }, [protectedKeys, retryUnlock, unlock]);

  useEffect(() => {
    if (protectedKeys !== false) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) return attempt();
    });
    return () => {
      cancelled = true;
    };
  }, [protectedKeys, attempt]);

  useEffect(() => {
    if (!protectedKeys) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (identityStatus === 'ready' || identityStatus === 'invalidated') open();
      else if (identityStatus === 'blocked') setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [protectedKeys, identityStatus, open]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (useLockStore.getState().prompting) return;

      if (protectedKeys) {
        if (useIdentityStore.getState().status === 'blocked') attempt();
        return;
      }
      attempt();
    });
    return () => subscription.remove();
  }, [attempt, protectedKeys]);

  return (
    <View className="absolute inset-0 bg-canvas">
      <Screen className="items-center justify-center gap-6">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-surface-sunken">
          <Icon
            name={failed ? 'lock-closed-outline' : 'finger-print-outline'}
            size={34}
            color={failed ? colors.danger : colors['content-muted']}
          />
        </View>

        <View className="items-center gap-1.5 px-gutter">
          <Text className="text-title font-semibold">Status Original</Text>
          <Text variant="footnote" className="text-center">
            {failed ? `${label} was not recognised.` : `Unlocking with ${label}…`}
          </Text>
        </View>

        {failed ? (
          <Button label="Try again" disabled={prompting} onPress={attempt} />
        ) : (
          <ActivityIndicator color={colors['content-subtle']} />
        )}
      </Screen>
    </View>
  );
}
