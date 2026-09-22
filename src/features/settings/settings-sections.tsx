import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Chevron, ConfirmSheet, ListItem, RowIcon, Section, toast } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { readCredentials, type Credentials } from '@/core/identity/credentials';
import { useChatStore, xmtpSessionFor } from '@/core/messaging/chat-store';
import { transportProtocols } from '@/protocols';
import { xmtpEnvironment } from '@/protocols/xmtp/shared';
import { eraseAccount } from '@/core/app/erase-account';
import { usePluginHost } from '@/core/plugins/host';
import { errorMessage } from '@/core/errors';
import { BiometricSection } from '@/features/settings/biometric-section';
import { openTab } from '@/features/navigation/open';

/** The routes the sections open, so a layout showing both can mark the open one. */
export const SETTINGS_PAGES = [
  'accounts',
  'identity',
  'appearance',
  'privacy',
  'tokens',
  'trades',
  'gifs',
  'devices',
  'plugins',
  'protocols',
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/**
 * Which optional keys the account has. Reloaded whenever `revision` changes,
 * which a screen ties to focus and the desktop sidebar to navigation.
 */
export function useSettingsKeys(revision: unknown): Credentials {
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);
  const [keys, setKeys] = useState<{ accountId: string; credentials: Credentials } | null>(null);

  useEffect(() => {
    if (!activeAccountId) return;
    let cancelled = false;
    const accountId = activeAccountId;
    readCredentials(accountId)
      .catch((): Credentials => ({}))
      .then((credentials) => {
        if (!cancelled) setKeys({ accountId, credentials });
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, revision]);

  // Another account's keys never show, not even for the moment a load takes.
  return keys?.accountId === activeAccountId ? keys.credentials : {};
}

export function SettingsSections({
  keys,
  selected,
  compact = false,
}: {
  keys: Credentials;
  selected?: SettingsPage;
  /** Titles only, for a narrow column. */
  compact?: boolean;
}) {
  const router = useRouter();
  const chevron = compact ? undefined : <Chevron />;
  const hint = (text: string) => (compact ? undefined : text);
  const accounts = useIdentityStore((s) => s.accounts);
  const xmtp = useChatStore(xmtpSessionFor);
  const protocols = useChatStore((s) => s.protocols);
  const { enabledIds, registry } = usePluginHost();

  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);

  return (
    <>
      <Section title="Account" surface="card" className="mb-6">
        <ListItem
          testID="settings-accounts"
          title="Accounts"
          subtitle={
            compact
              ? undefined
              : accounts.length === 1
                ? 'Add another account or switch between them'
                : `${accounts.length} accounts on this device`
          }
          leading={<RowIcon name="people-outline" tone="blue" />}
          trailing={chevron}
          selected={selected === 'accounts'}
          onPress={() => openTab('/accounts')}
        />
        <ListItem
          testID="settings-qr-row"
          title="My QR code"
          subtitle={hint('Let someone scan your address to start a chat')}
          numberOfLinesSubtitle={2}
          leading={<RowIcon name="qr-code-outline" tone="purple" />}
          trailing={chevron}
          onPress={() => router.push('/qr')}
        />
        <ListItem
          testID="settings-identity"
          title="Recovery phrase"
          subtitle={hint('View the words that control this account')}
          numberOfLinesSubtitle={2}
          leading={<RowIcon name="key-outline" tone="orange" />}
          trailing={chevron}
          selected={selected === 'identity'}
          onPress={() => openTab('/settings/identity')}
        />
        <ListItem
          testID="settings-erase-account"
          title="Erase this account"
          subtitle={hint('Removes its keys and every message kept here. Only the recovery phrase brings it back.')}
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
          subtitle={hint('Theme and chat wallpaper')}
          leading={<RowIcon name="color-palette-outline" tone="pink" />}
          trailing={chevron}
          selected={selected === 'appearance'}
          onPress={() => openTab('/settings/appearance')}
        />
        <ListItem
          testID="settings-privacy"
          title="Privacy"
          subtitle={hint('Read receipts, and what this app deliberately does not collect')}
          numberOfLinesSubtitle={2}
          leading={<RowIcon name="hand-left-outline" tone="grey" />}
          trailing={chevron}
          selected={selected === 'privacy'}
          onPress={() => openTab('/settings/privacy')}
        />
        <ListItem
          testID="settings-tokens"
          title="Tokens"
          subtitle={hint(keys.tokens ? 'Showing tokens you hold' : 'Add an Alchemy key to see tokens')}
          leading={<RowIcon name="diamond-outline" tone="teal" />}
          trailing={chevron}
          selected={selected === 'tokens'}
          onPress={() => openTab('/settings/tokens')}
        />
        <ListItem
          testID="settings-trades"
          title="Trades"
          subtitle={hint(keys.trades ? 'Swaps and bridges use your LI.FI key' : 'Swap and bridge through LI.FI')}
          leading={<RowIcon name="swap-horizontal-outline" tone="blue" />}
          trailing={chevron}
          selected={selected === 'trades'}
          onPress={() => openTab('/settings/trades')}
        />
        <ListItem
          testID="settings-gifs"
          title="GIFs"
          subtitle={hint(keys.gifs ? 'Search is on' : 'Add a KLIPY key to search GIFs')}
          leading={<RowIcon name="happy-outline" tone="green" />}
          trailing={chevron}
          selected={selected === 'gifs'}
          onPress={() => openTab('/settings/gifs')}
        />
        <ListItem
          testID="settings-devices"
          title="Devices"
          subtitle={hint('Where this account is signed in')}
          leading={<RowIcon name="phone-portrait-outline" tone="orange" />}
          trailing={chevron}
          selected={selected === 'devices'}
          onPress={() => openTab('/settings/devices')}
        />
      </Section>

      <Section title="Extensions" surface="card" className="mb-6">
        <ListItem
          testID="settings-plugins"
          title="Plugins"
          subtitle={hint(`${enabledIds.length} of ${registry.list().length} enabled`)}
          leading={<RowIcon name="extension-puzzle-outline" tone="purple" />}
          trailing={chevron}
          selected={selected === 'plugins'}
          onPress={() => openTab('/settings/plugins')}
        />
      </Section>

      <Section title="Network" surface="card" className="mb-6">
        <ListItem
          testID="settings-protocols"
          title="Protocols"
          subtitle={hint(describeConnections(protocols))}
          numberOfLinesSubtitle={2}
          leading={<RowIcon name="git-network-outline" tone="blue" />}
          trailing={chevron}
          selected={selected === 'protocols'}
          onPress={() => openTab('/settings/protocols')}
        />
        <ListItem
          title="XMTP network"
          subtitle={compact ? xmtpEnvironment() : `${xmtpEnvironment()}, reachable only from clients on the same network`}
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
    </>
  );
}

function describeConnections(
  connections: Record<string, { status: string; error: string | null; login?: unknown }>,
): string {
  const connected = transportProtocols().filter(
    (p) => connections[p.id]?.status === 'ready' && !connections[p.id]?.login,
  );
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
