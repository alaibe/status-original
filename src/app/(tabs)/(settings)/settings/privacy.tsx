import { Stack } from 'expo-router';
import { ScrollView, Switch } from 'react-native';

import { Icon, ListItem, Screen, Section, Text, useThemeColors } from '@/design';
import { useAppearanceStore } from '@/core/app/appearance';

export default function PrivacyScreen() {
  const colors = useThemeColors();

  const readReceipts = useAppearanceStore((s) => s.readReceipts);
  const setReadReceipts = useAppearanceStore((s) => s.setReadReceipts);

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Privacy' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 48 }}>

        <Section title="Receipts" surface="card" className="mb-4">
          <ListItem
            title="Send read receipts"
            subtitle="Tells the other person when you have opened their message. Off by default, and it works both ways: with it off, you do not see theirs either."
            numberOfLinesSubtitle={4}
            leading={
              <Icon name="checkmark-done-outline" size={20} color={colors['content-muted']} />
            }
            trailing={<Switch value={readReceipts} onValueChange={setReadReceipts} />}
          />
        </Section>

        <Text variant="footnote" className="px-gutter pb-6">
          Unread state is otherwise kept on this device only. Nothing tells anyone which
          conversations you have open, which you have pinned, or which you have muted.
        </Text>

        <Section title="Not collected" surface="card" className="mb-4">
          <ListItem
            title="No last seen"
            subtitle="The protocols carry no presence, and this app does not add a side-channel to broadcast when you are online."
            numberOfLinesSubtitle={3}
            leading={<Icon name="eye-off-outline" size={20} color={colors['content-muted']} />}
          />
          <ListItem
            title="No typing indicator"
            subtitle="For the same reason: it would mean sending a signal every time you touch the keyboard."
            numberOfLinesSubtitle={3}
            leading={<Icon name="ellipsis-horizontal" size={20} color={colors['content-muted']} />}
          />
          <ListItem
            title="No contact upload"
            subtitle="Your address book is read on this device to suggest invites and is never sent anywhere."
            numberOfLinesSubtitle={3}
            leading={<Icon name="people-outline" size={20} color={colors['content-muted']} />}
          />
        </Section>
      </ScrollView>
    </Screen>
  );
}
