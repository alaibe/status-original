import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, View } from 'react-native';

import {
  Avatar,
  Button,
  Field,
  Icon,
  ListItem,
  Note,
  Pressable,
  Screen,
  Section,
  Text,
  toast,
  useThemeColors,
} from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import {
  askForAccess,
  contactSortKeyFor,
  currentAccess,
  readDeviceContacts,
  type ContactAccess,
  type DeviceContact,
} from '@/features/contacts/device-contacts';
import { ContactName } from '@/features/contacts/contact-name';

function inviteText(address: string): string {
  return (
    `I'm on Status Original, encrypted chat where your account is a key instead of a phone number.\n\n` +
    `Add me: ${address}`
  );
}

export default function InviteScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const keyring = useIdentityStore((s) => s.keyring);

  const [access, setAccess] = useState<ContactAccess>('unknown');
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (privileges: ContactAccess) => {
    if (privileges === 'none' || privileges === 'unknown') {
      setContacts([]);
      return;
    }
    const rows = await readDeviceContacts();
    setContacts(
      [...rows].sort((a, b) =>
        contactSortKeyFor(a, 'family').localeCompare(contactSortKeyFor(b, 'family'))
      )
    );
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const privileges = await currentAccess();
        setAccess(privileges);
        await load(privileges);
      } catch {
        setAccess('none');
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      `${c.given ?? ''} ${c.family ?? ''}`.toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendInvites() {
    if (!keyring) return;

    const chosen = contacts.filter((c) => selected.has(c.id));
    const numbers = chosen.map((c) => c.phone).filter((p): p is string => Boolean(p));
    const body = inviteText(keyring.address);

    if (numbers.length === 0) {
      await Share.share({ message: body }).catch(() => {});
      return;
    }

    const url = `sms:${numbers.join(',')}&body=${encodeURIComponent(body)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('no sms');
      await Linking.openURL(url);
    } catch {
      await Share.share({ message: body }).catch(() => {});
    }

    const skipped = chosen.length - numbers.length;
    if (skipped > 0) {
      toast.info(`${skipped} contact${skipped === 1 ? '' : 's'} had no phone number`);
    }
  }

  return (
    <Screen className="px-0" edges={['top']}>
      <View className="flex-row items-center justify-between px-gutter pb-4 pt-4">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()}>
          <Icon name="close" size={24} color={colors['content-muted']} />
        </Pressable>
        <Text className="text-body font-semibold">Invite friends</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            setSelected(allVisibleSelected ? new Set() : new Set(visible.map((c) => c.id)))
          }>
          <Text className="font-medium text-brand">
            {allVisibleSelected ? 'Clear' : 'Select all'}
          </Text>
        </Pressable>
      </View>

      <View className="px-gutter pb-4">
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <Section surface="list">
          <ListItem
            testID="share-app"
            title={<Text className="font-semibold text-brand">Share Status Original</Text>}
            leading={<Icon name="heart-outline" size={22} color={colors.brand} />}
            onPress={async () => {
              if (!keyring) return;
              await Share.share({ message: inviteText(keyring.address) }).catch(() => {});
            }}
          />
        </Section>

        {loading ? (
          <View className="py-10">
            <ActivityIndicator />
          </View>
        ) : access === 'none' || access === 'unknown' ? (
          <Note className="mx-gutter mt-6" icon="lock-closed-outline">
            <Text variant="footnote">
              Your address book can suggest who to invite. It is read on this device only, never
              uploaded and never matched against a server. That is why this list cannot tell you
              who is already here.
            </Text>
            <Button
              label="Allow contacts"
              onPress={async () => {
                const privileges = await askForAccess();
                setAccess(privileges);
                await load(privileges).catch(() => {});
              }}
            />
          </Note>
        ) : (
          <Section title={`Contacts · ${visible.length}`} surface="list" className="mt-6">
            {visible.map((contact) => {
              const isSelected = selected.has(contact.id);
              return (
                <ListItem
                  key={contact.id}
                  title={<ContactName given={contact.given} family={contact.family} />}
                  subtitle={contact.phone ?? 'No phone number'}
                  leading={
                    <Avatar
                      seed={`${contact.given ?? ''}${contact.family ?? ''}`}
                      size="md"
                    />
                  }
                  trailing={
                    <Icon
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={isSelected ? colors.brand : colors['content-subtle']}
                    />
                  }
                  onPress={() => toggle(contact.id)}
                />
              );
            })}
          </Section>
        )}
      </ScrollView>

      {selected.size > 0 ? (
        <View className="absolute inset-x-0 bottom-0 border-t border-line bg-surface-raised px-gutter pb-8 pt-3">
          <Button
            label={`Invite ${selected.size}`}
            fullWidth
            onPress={sendInvites}
          />
        </View>
      ) : null}
    </Screen>
  );
}
