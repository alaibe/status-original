import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Avatar,
  Badge,
  Chevron,
  ConfirmSheet,
  IconButton,
  ListItem,
  RowIcon,
  Screen,
  Section,
  Text,
  toast,
} from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { loadGifKey } from '@/features/chat/attachments/gifs';
import { loadTokenKey } from '@/core/identity/token-key';
import { shortAddress } from '@/core/identity/keyring';
import { useChatStore, xmtpSessionFor } from '@/core/messaging/chat-store';
import { transportProtocols } from '@/protocols';
import { xmtpEnvironment } from '@/protocols/xmtp/adapter';
import { eraseAccount } from '@/core/app/erase-account';
import { usePluginHost } from '@/core/plugins/host';
import { lookupName } from '@/lib/evm/ens';

import { errorMessage } from '@/core/errors';
import { BiometricSection } from '@/features/settings/biometric-section';

export default function SettingsScreen() {
  const router = useRouter();

  const keyring = useIdentityStore((s) => s.keyring);
  const accounts = useIdentityStore((s) => s.accounts);
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);
  const chatStatus = useChatStore((s) => s.status);
  const xmtp = useChatStore(xmtpSessionFor);
  const protocols = useChatStore((s) => s.protocols);
  const { enabledIds, registry } = usePluginHost();

  const [gifKey, setGifKey] = useState<string | null>(null);
  const [tokenKey, setTokenKey] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setGifKey(null);
      setTokenKey(null);
      if (!activeAccountId) return () => { cancelled = true; };
      loadGifKey(activeAccountId)
        .then((key) => { if (!cancelled) setGifKey(key); })
        .catch(() => { if (!cancelled) setGifKey(null); });
      loadTokenKey(activeAccountId)
        .then((key) => { if (!cancelled) setTokenKey(key); })
        .catch(() => { if (!cancelled) setTokenKey(null); });
      return () => { cancelled = true; };
    }, [activeAccountId]),
  );

  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);

  const [ensName, setEnsName] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const address = keyring?.address;
      if (!address) return;
      let cancelled = false;
      lookupName(address)
        .then((name) => {
          if (!cancelled) setEnsName(name);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [keyring?.address]),
  );

  const account = accounts.find((a) => a.id === activeAccountId);

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Settings', headerTransparent: false }} />

      <ScrollView contentInsetAdjustmentBehavior="automatic">
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
              onPress={() =>
                WebBrowser.openBrowserAsync('https://app.ens.domains', {
                  presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
                })
              }
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
            tone={
              chatStatus === 'ready' ? 'success' : chatStatus === 'error' ? 'danger' : 'neutral'
            }
          />
        </View>

        <Section title="Account" surface="card" className="mb-6">
          <ListItem
            testID="settings-accounts"
            title="Accounts"
            subtitle={
              accounts.length === 1
                ? 'Add another account or switch between them'
                : `${accounts.length} accounts on this device`
            }
            leading={<RowIcon name="people-outline" tone="blue" />}
            trailing={<Chevron />}
            onPress={() => router.push('/accounts')}
          />
          <ListItem
            testID="settings-qr-row"
            title="My QR code"
            subtitle="Let someone scan your address to start a chat"
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="qr-code-outline" tone="purple" />}
            trailing={<Chevron />}
            onPress={() => router.push('/qr')}
          />
          <ListItem
            testID="settings-identity"
            title="Recovery phrase"
            subtitle="View the words that control this account"
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="key-outline" tone="orange" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/identity')}
          />
          <ListItem
            testID="settings-erase-account"
            title="Erase this account"
            subtitle="Removes its keys and every message kept here. Only the recovery phrase brings it back."
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="trash-outline" tone="red" />}
            onPress={() => setConfirmErase(true)}
          />
        </Section>

        <BiometricSection />

        <Section title="Preferences" surface="card" className="mb-6">
          <ListItem
            testID="settings-appearance"
            title="Appearance"
            subtitle="Theme and chat wallpaper"
            leading={<RowIcon name="color-palette-outline" tone="pink" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/appearance')}
          />
          <ListItem
            testID="settings-privacy"
            title="Privacy"
            subtitle="Read receipts, and what this app deliberately does not collect"
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="hand-left-outline" tone="grey" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/privacy')}
          />
          <ListItem
            testID="settings-tokens"
            title="Tokens"
            subtitle={tokenKey ? 'Showing tokens you hold' : 'Add an Alchemy key to see tokens'}
            leading={<RowIcon name="diamond-outline" tone="teal" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/tokens')}
          />
          <ListItem
            testID="settings-gifs"
            title="GIFs"
            subtitle={gifKey ? 'Search is on' : 'Add a Tenor key to search GIFs'}
            leading={<RowIcon name="happy-outline" tone="green" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/gifs')}
          />
          <ListItem
            testID="settings-devices"
            title="Devices"
            subtitle="Where this account is signed in"
            leading={<RowIcon name="phone-portrait-outline" tone="orange" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/devices')}
          />
        </Section>

        <Section title="Extensions" surface="card" className="mb-6">
          <ListItem
            testID="settings-plugins"
            title="Plugins"
            subtitle={`${enabledIds.length} of ${registry.list().length} enabled`}
            leading={<RowIcon name="extension-puzzle-outline" tone="purple" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/plugins')}
          />
        </Section>

        <Section title="Network" surface="card" className="mb-6">
          <ListItem
            testID="settings-protocols"
            title="Protocols"
            subtitle={describeConnections(protocols)}
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="git-network-outline" tone="blue" />}
            trailing={<Chevron />}
            onPress={() => router.push('/settings/protocols')}
          />
          <ListItem
            title="XMTP network"
            subtitle={`${xmtpEnvironment()}, reachable only from clients on the same network`}
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="globe-outline" tone="teal" />}
          />
          <ListItem
            title="Inbox id"
            subtitle={xmtp?.self.participantId ?? 'Not connected'}
            numberOfLinesSubtitle={1}
            leading={<RowIcon name="finger-print-outline" tone="grey" />}
          />
        </Section>
      </ScrollView>

      <ConfirmSheet
        visible={confirmErase}
        onClose={() => setConfirmErase(false)}
        title="Erase this account?"
        body="This erases the keys and every message stored on this device. Nothing is kept, and nobody can send it back to you. The only way to return is the recovery phrase."
        busy={erasing}
        confirm={{
          testID: 'confirm-erase-account',
          label: 'Erase account',
          tone: 'danger',
          onPress: async () => {
            setErasing(true);
            try {
              await eraseAccount();
              setConfirmErase(false);
            } catch (error) {
              toast.error(errorMessage(error, 'Could not erase that account'));
            }
            setErasing(false);
          },
        }}
      />
    </Screen>
  );
}

function describeConnections(
  connections: Record<string, { status: string; error: string | null }>,
): string {
  const connected = transportProtocols().filter((p) => connections[p.id]?.status === 'ready');
  const failed = transportProtocols().filter((p) => connections[p.id]?.status === 'error');

  if (connected.length === 0) {
    return failed.length > 0
      ? `Nothing connected: ${failed.map((p) => p.label).join(' and ')} failed`
      : 'Nothing connected yet';
  }

  const summary = `${connected.map((p) => p.label).join(', ')} connected`;
  return failed.length > 0
    ? `${summary} · ${failed.map((p) => p.label).join(', ')} failed`
    : summary;
}
