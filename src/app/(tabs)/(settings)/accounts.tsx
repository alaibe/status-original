import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  ActionSheet,
  Avatar,
  Button,
  ConfirmSheet,
  Field,
  Icon,
  ListItem,
  Screen,
  Section,
  Sheet,
  SwipeableRow,
  Text,
  toast,
  useThemeColors,
} from '@/design';
import { eraseAccount } from '@/core/app/erase-account';
import { errorMessage } from '@/core/errors';
import { useIdentityStore } from '@/core/identity/identity-store';
import { shortAddress } from '@/core/identity/keyring';
import { describeKind } from '@/core/identity/account-kind';
import { hardwareVendors } from '@/core/identity/hardware';
import { ConnectHardware } from '@/features/identity/connect-hardware';

export default function AccountsScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const accounts = useIdentityStore((s) => s.accounts);
  const activeAccountId = useIdentityStore((s) => s.activeAccountId);
  const selectAccount = useIdentityStore((s) => s.selectAccount);
  const renameAccount = useIdentityStore((s) => s.renameAccount);

  const [managing, setManaging] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const target = accounts.find((a) => a.id === (managing ?? renaming ?? confirmWipe));

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Accounts' }} />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>

        <Text variant="footnote" className="px-gutter pb-4">
          Each account has its own keys, its own message database and its own plugin settings.
          Nothing is shared between them. Tap one to switch to it, hold to rename or erase it.
        </Text>

        <Section surface="card" className="mb-6">
          {accounts.map((account) => (
            <SwipeableRow
              key={account.id}
              right={[
                {
                  id: 'erase',
                  label: 'Erase',
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () => setConfirmWipe(account.id),
                },
              ]}>
            <ListItem
              key={account.id}
              testID={`account-${account.id}`}
              title={account.label}
              subtitle={
                account.kind === 'hardware'
                  ? `${shortAddress(account.address, 8, 6)} · ${describeKind('hardware')}`
                  : shortAddress(account.address, 10, 8)
              }
              numberOfLinesSubtitle={2}
              leading={<Avatar seed={account.address} size="md" />}
              // Only state on the right: tapping switches, holding manages, swiping erases.
              trailing={
                account.id === activeAccountId ? (
                  <Icon name="checkmark-circle" size={20} color={colors.brand} />
                ) : undefined
              }
              onLongPress={() => setManaging(account.id)}
              onPress={async () => {
                if (account.id === activeAccountId) {
                  setManaging(account.id);
                  return;
                }
                try {
                  await selectAccount(account.id);
                  router.replace('/chats');
                } catch (error) {
                  toast.error(errorMessage(error, 'Could not open that account'));
                }
              }}
            />
            </SwipeableRow>
          ))}
        </Section>

        <View className="gap-2 px-gutter">
          <Button
            label="Create a new account"
            fullWidth
            onPress={() => router.push('/(onboarding)/create')}
          />
          <Button
            label="Import a recovery phrase"
            tone="neutral"
            fullWidth
            onPress={() => router.push('/(onboarding)/import')}
          />
          {hardwareVendors().length > 0 ? (
            <Button
              testID="connect-hardware"
              label="Connect a hardware wallet"
              tone="neutral"
              fullWidth
              onPress={() => setConnecting(true)}
            />
          ) : null}
        </View>
      </ScrollView>

      <ConnectHardware visible={connecting} onClose={() => setConnecting(false)} />

      <ActionSheet
        visible={managing !== null}
        onClose={() => setManaging(null)}
        title={target?.label}
        actions={[
          {
            label: 'Rename',
            onPress: () => {
              setDraftLabel(target?.label ?? '');
              setRenaming(managing);
            },
          },
          { label: 'Erase this account', tone: 'danger', onPress: () => setConfirmWipe(managing) },
        ]}
      />

      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} title="Rename account">
        <View className="gap-3 pb-2">
          <Field
            defaultValue={draftLabel}
            onChangeText={setDraftLabel}
            autoFocus
            placeholder="Personal"
            maxLength={40}
            // The same distinction the create screen draws. Without it the
            // field looks like it sets what other people see, and it is the
            // one name that never leaves the device.
            hint="Just for you, on this device. An ENS name is the one other people see."
          />
          <Button
            label="Save"
            fullWidth
            disabled={draftLabel.trim().length === 0}
            onPress={async () => {
              if (renaming) await renameAccount(renaming, draftLabel);
              setRenaming(null);
            }}
          />
          <Button label="Cancel" tone="ghost" fullWidth onPress={() => setRenaming(null)} />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmWipe !== null}
        onClose={() => setConfirmWipe(null)}
        title="Erase this account?"
        body={`This deletes ${target?.label}'s keys, messages and plugin data from this device. Nobody else holds them, so without its recovery phrase written down the account cannot be recovered. Your other accounts are untouched.`}
        busy={busy}
        confirm={{
          label: 'Erase account',
          busyLabel: 'Erasing…',
          tone: 'danger',
          onPress: async () => {
            if (!confirmWipe) return;
            setBusy(true);
            const next = accounts.length === 1 ? '/(onboarding)/welcome' : '/chats';
            try {
              await eraseAccount(confirmWipe);
              setConfirmWipe(null);
              router.replace(next);
            } catch (error) {
              toast.error(errorMessage(error, 'Could not erase that account'));
            }
            setBusy(false);
          },
        }}
      />
    </Screen>
  );
}
