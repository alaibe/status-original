import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import {
  Badge,
  Card,
  ConfirmSheet,
  Icon,
  ListItem,
  Note,
  Screen,
  Section,
  Text,
  toast,
  useThemeColors,
} from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore, xmtpSessionFor } from '@/core/messaging/chat-store';
import { formatDayLabel } from '@/core/messaging/preview';

interface Installation {
  id: string;
  createdAt?: number;
  current: boolean;
}

export default function DevicesScreen() {
  const colors = useThemeColors();
  const session = useChatStore(xmtpSessionFor);

  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Installation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session?.listInstallations) {
      setInstallations([]);
      return;
    }
    try {
      setInstallations(await session.listInstallations());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not read your devices'));
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function revoke(installation: Installation) {
    if (!session?.revokeInstallations) return;
    setBusy(true);
    try {
      await session.revokeInstallations([installation.id]);
      toast.success('Device revoked');
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not revoke that device'));
    }
    setBusy(false);
    setConfirming(null);
  }

  const others = (installations ?? []).filter((i) => !i.current);
  const here = (installations ?? []).find((i) => i.current);

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Devices' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 48 }}>
        {installations === null ? (
          <View className="py-10">
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <Section title="This device" surface="card" className="mb-6">
              {here ? (
                <ListItem
                  title="Signed in here"
                  subtitle={describe(here)}
                  numberOfLinesSubtitle={2}
                  leading={<Icon name="phone-portrait-outline" size={20} color={colors.brand} />}
                  trailing={<Badge label="Current" tone="success" />}
                />
              ) : (
                <View className="px-gutter py-6">
                  <Text variant="footnote">
                    This transport does not report devices, so there is nothing to show here.
                  </Text>
                </View>
              )}
            </Section>

            <Section
              title={others.length > 0 ? `Other devices · ${others.length}` : 'Other devices'}
              surface="card"
              className="mb-4">
              {others.length === 0 ? (
                <View className="px-gutter py-6">
                  <Text variant="footnote">
                    This account is only signed in here.
                  </Text>
                </View>
              ) : (
                others.map((installation) => (
                  <ListItem
                    key={installation.id}
                    title={`Device ${installation.id.slice(0, 8)}`}
                    subtitle={describe(installation)}
                    numberOfLinesSubtitle={2}
                    leading={
                      <Icon name="phone-portrait-outline" size={20} color={colors['content-muted']} />
                    }
                    trailing={
                      <Icon name="close-circle-outline" size={20} color={colors.danger} />
                    }
                    onPress={() => setConfirming(installation)}
                  />
                ))
              )}
            </Section>
          </>
        )}

        {error ? (
          <Card className="mx-gutter mb-4">
            <Text variant="footnote" className="text-danger">
              {error}
            </Text>
          </Card>
        ) : null}

        <Note className="mx-gutter" title="What a device is" icon="phone-portrait-outline">
          <Text variant="footnote">
            Each device holds its own keys and its own copy of your messages. Nothing sits on a
            server for a new device to download. That is why a fresh install starts empty, and why
            revoking a device here cuts it off for good rather than signing it out.
          </Text>
        </Note>
      </ScrollView>

      <ConfirmSheet
        visible={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Revoke this device?"
        body={[
          'That device will no longer be able to read or send messages for this account. It cannot be undone: the device would have to be added again from scratch, and it would start with no history.',
          'This needs a signature from your account.',
        ]}
        busy={busy}
        confirm={{
          label: 'Revoke device',
          busyLabel: 'Revoking…',
          tone: 'danger',
          onPress: () => confirming && revoke(confirming),
        }}
      />
    </Screen>
  );
}

function describe(installation: Installation): string {
  const id = `${installation.id.slice(0, 12)}…`;
  return installation.createdAt
    ? `Added ${formatDayLabel(installation.createdAt)} · ${id}`
    : id;
}
