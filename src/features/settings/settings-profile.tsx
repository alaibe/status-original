import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Avatar, Badge, IconButton, Text } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { shortAddress } from '@/core/identity/keyring';
import { useChatStore } from '@/core/messaging/chat-store';
import { lookupName } from '@/lib/evm/ens';
import { openInBrowser } from '@/lib/open-url';

/** Looked up again whenever `revision` changes, so a name claimed on the ENS site shows on the way back. */
export function useEnsName(revision: unknown): string | null {
  const address = useIdentityStore((s) => s.keyring?.address);
  const [ens, setEns] = useState<{ address: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    lookupName(address)
      .then((name) => {
        if (!cancelled) setEns({ address, name });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, revision]);

  return ens && ens.address === address ? ens.name : null;
}

/** The account at the top of Settings: who you are, and whether you are connected. */
export function SettingsProfile({ ensName }: { ensName: string | null }) {
  const router = useRouter();
  const keyring = useIdentityStore((s) => s.keyring);
  const accounts = useIdentityStore((s) => s.accounts);
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);
  const chatStatus = useChatStore((s) => s.status);

  const account = accounts.find((a) => a.id === activeAccountId);

  return (
    <View className="items-center gap-2 px-gutter pb-6 pt-2">
      <View className="w-full flex-row items-center justify-between">
        <IconButton
          testID="settings-qr"
          icon="qr-code-outline"
          label="My QR code"
          onPress={() => router.push('/qr')}
        />
        {/*
          Opens ENS in the browser, the only place the name other people
          see can be changed: an ENS reverse record is an on-chain claim
          this app reads and does not write. The label under the avatar,
          which is only yours, is edited in Accounts.
        */}
        <IconButton
          testID="settings-ens"
          icon={ensName ? 'create-outline' : 'add-circle-outline'}
          label={ensName ? `Edit ${ensName} on ENS` : 'Get an ENS name'}
          onPress={() => openInBrowser('https://app.ens.domains', { fullScreen: true })}
        />
      </View>

      <Avatar seed={keyring?.address ?? 'anon'} size="xl" />

      <View className="items-center gap-0.5">
        <Text variant="title" className="font-semibold">
          {ensName ?? account?.label ?? 'Your account'}
        </Text>
        <Text variant="mono" selectable>
          {keyring ? shortAddress(keyring.address, 10, 8) : '—'}
        </Text>
      </View>

      <Badge
        label={chatStatus === 'ready' ? 'Connected' : chatStatus}
        tone={chatStatus === 'ready' ? 'success' : chatStatus === 'error' ? 'danger' : 'neutral'}
      />
    </View>
  );
}
