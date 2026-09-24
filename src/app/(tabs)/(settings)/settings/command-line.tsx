import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { Button, Card, ListItem, Screen, Section, Text } from '@/design';
import { copyText } from '@/design/copy-text';
import { isCliAllowed, setCliAllowed } from '@/features/cli/access';
import { cliInstall, type CliInstall } from '@/features/cli/install';

const SKILLS = 'status-original skills install';

function Command({ command, done }: { command: string; done: string }) {
  return (
    <Card className="gap-3">
      <Text selectable className="font-mono text-sm">
        {command}
      </Text>
      <Button label="Copy" tone="neutral" size="sm" onPress={() => copyText(command, done)} />
    </Card>
  );
}

export default function CommandLineScreen() {
  const [install, setInstall] = useState<CliInstall | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    cliInstall()
      .then(setInstall)
      .catch(() => {});
    isCliAllowed()
      .then(setAllowed)
      .catch(() => {});
  }, []);

  async function toggle(next: boolean) {
    setAllowed(next);
    await setCliAllowed(next).catch(() => setAllowed(!next));
  }

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Command line' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 48 }}>
        <View className="gap-2 px-gutter pb-6">
          <Text variant="body">
            status-original does from a terminal whatever this app does: read and send messages,
            manage chats and groups, run plugin commands. It talks to this app, and starts it in the
            background when it is closed.
          </Text>
          <Text variant="footnote">
            Anything that signs, erases or turns on a plugin waits for you to approve it here.
          </Text>
        </View>

        <Section surface="card" className="mb-6">
          <ListItem
            testID="cli-allowed"
            title="Allow the command line"
            subtitle="While this is on, any program running as you on this computer can read and send your messages through it, without asking. Off by default."
            numberOfLinesSubtitle={4}
            trailing={<Switch value={allowed} onValueChange={toggle} />}
          />
        </Section>

        <Section title="Install" surface="card" className="mb-6">
          <View className="gap-3 p-4">
            {install?.installed ? (
              <Text variant="footnote">
                Installed. Open a terminal and run status-original help.
              </Text>
            ) : install?.command ? (
              <>
                <Text variant="footnote">
                  Run this once in Terminal. It asks for your password to add the command to
                  /usr/local/bin.
                </Text>
                <Command command={install.command} done="Command copied" />
              </>
            ) : null}
          </View>
        </Section>

        <Section title="AI agents" surface="card" className="mb-6">
          <View className="gap-3 p-4">
            <Text variant="footnote">
              Teaches Claude Code how to use it. Add --codex for Codex, or --dir with a folder for
              another agent.
            </Text>
            <Command command={SKILLS} done="Command copied" />
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}
