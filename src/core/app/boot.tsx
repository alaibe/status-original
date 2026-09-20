import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useIdentityStore } from '../identity/identity-store';
import { registerHardwareVendors } from '../identity/vendors';
import { useLockStore } from '../identity/lock-store';
import { usePluginHost } from '../plugins/host';
import { accountRuntime } from '@/runtime';

registerHardwareVendors();

export function useAppBoot(): void {
  const status = useIdentityStore((s) => s.status);
  const keyring = useIdentityStore((s) => s.keyring);
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);
  const restore = useIdentityStore((s) => s.restore);
  const { registry, defaultEnabled, makeContext, onPluginsChanged } = usePluginHost();

  useEffect(() => {
    if (status === 'loading') restore();
  }, [status, restore]);

  useEffect(() => {
    void accountRuntime.synchronize(
      status === 'ready' && keyring && activeAccountId
        ? {
            accountId: activeAccountId,
            keyring,
            registry,
            defaultEnabled,
            makeContext,
            onPluginsChanged,
          }
        : null
    );
  }, [status, keyring, activeAccountId, registry, defaultEnabled, makeContext, onPluginsChanged]);
}

export function useDeepLinkRouter() {
  const { handleUri } = usePluginHost();

  useEffect(() => {
    const consume = (url: string | null) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      const wrapped = typeof parsed.queryParams?.uri === 'string' ? parsed.queryParams.uri : null;
      handleUri(wrapped ?? url).catch((error) => {
        console.warn('[deeplink] no handler for', url, error);
      });
    };

    Linking.getInitialURL().then(consume);
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, [handleUri]);
}

export function useAppLock() {
  const status = useLockStore((s) => s.status);
  const evaluate = useLockStore((s) => s.evaluate);

  useEffect(() => {
    if (status === 'checking') evaluate();
  }, [status, evaluate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const lock = useLockStore.getState();
      if (next === 'active') lock.noteForegrounded();
      else lock.noteBackgrounded();
    });
    return () => subscription.remove();
  }, []);

  return status;
}
