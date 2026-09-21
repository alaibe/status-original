import { Stack } from 'expo-router';

import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import {
  Badge,
  Button,
  ConfirmSheet,
  ListItem,
  RowIcon,
  Screen,
  Section,
  Sheet,
  Text,
  toast,
  type RowIconTone,
  useThemeColors,
} from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';
import { botChatLoss, botChatLossCopy, type BotChatLoss } from '@/core/plugins/bot-chats';
import { usePluginHost } from '@/core/plugins/host';
import { PERMISSION_LABELS, type Plugin } from '@/core/plugins/types';
import { errorMessage } from '@/core/errors';

export default function PluginsScreen() {
  const { registry, enabledIds, setEnabled } = usePluginHost();
  const colors = useThemeColors();

  const [detail, setDetail] = useState<Plugin | null>(null);

  const [pendingDisable, setPendingDisable] = useState<{ plugin: Plugin; loss: BotChatLoss } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const apply = async (plugin: Plugin, next: boolean) => {
    const done = `${plugin.manifest.name} ${next ? 'enabled' : 'disabled'}`;
    try {
      await setEnabled(plugin.manifest.id, next);
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update plugin'));
    }
  };

  const onToggle = async (plugin: Plugin, next: boolean) => {
    if (next) return apply(plugin, true);

    const loss = botChatLoss(registry.botsOf(plugin.manifest.id), useChatStore.getState().messages);
    if (!loss) return apply(plugin, false);

    setPendingDisable({ plugin, loss });
  };

  const copy = pendingDisable
    ? botChatLossCopy(pendingDisable.plugin.manifest.name, pendingDisable.loss)
    : null;

  const detailHasChat = detail ? registry.botsOf(detail.manifest.id).length > 0 : false;

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Plugins' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}>
        <View className="gap-1 px-gutter pb-4">
          <Text variant="bodyMuted">
            Plugins add commands, message types and screens. They ship inside the app, so enabling
            one grants it the access its row lists.
          </Text>
        </View>

        <Section surface="card" className="mb-6">
          {registry.list().map((plugin) => {
            const enabled = enabledIds.includes(plugin.manifest.id);
            return (
              <ListItem
                key={plugin.manifest.id}
                testID={`plugin-${plugin.manifest.id}`}
                title={plugin.manifest.name}
                subtitle={plugin.manifest.description}
                numberOfLinesSubtitle={2}
                leading={
                  <RowIcon name={plugin.manifest.icon} tone={TONE[plugin.manifest.id] ?? 'grey'} />
                }
                trailing={
                  <Switch
                    value={enabled}
                    onValueChange={(next) => onToggle(plugin, next)}
                    trackColor={{ true: colors.brand, false: colors.line }}
                    accessibilityLabel={`${enabled ? 'Disable' : 'Enable'} ${plugin.manifest.name}`}
                  />
                }
                onPress={() => setDetail(plugin)}
              />
            );
          })}
        </Section>
      </ScrollView>

      <Sheet visible={detail !== null} onClose={() => setDetail(null)} title={detail?.manifest.name}>
        <View className="gap-3 pb-2">
          <Text variant="footnote">{detail?.manifest.description}</Text>

          <Section title="What it can reach">
            <View className="gap-1.5 pt-1">
              {detail?.manifest.permissions.map((permission) => (
                <Text key={permission} variant="caption">
                  {PERMISSION_LABELS[permission]}
                </Text>
              ))}
            </View>
          </Section>

          <View className="flex-row flex-wrap gap-1.5">
            <Badge label={`v${detail?.manifest.version}`} />
            {detail?.manifest.requiresSessionRestart ? (
              <Badge label="Reconnects chat" tone="warning" />
            ) : null}
            {detailHasChat ? <Badge label="Has its own chat" tone="brand" /> : null}
          </View>

          {detailHasChat ? (
            <Text variant="caption">
              Turning this off takes its chat out of your list. The transcript stays on this device
              and returns if you turn it back on.
            </Text>
          ) : null}

          <Button label="Done" tone="ghost" fullWidth onPress={() => setDetail(null)} />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={pendingDisable !== null}
        onClose={() => setPendingDisable(null)}
        title={copy?.title}
        body={copy?.body}
        busy={busy}
        cancelLabel="Keep it on"
        confirm={{
          label: copy?.confirmLabel ?? 'Turn off',
          busyLabel: 'Turning off…',
          tone: 'danger',
          onPress: async () => {
            if (!pendingDisable) return;
            setBusy(true);
            await apply(pendingDisable.plugin, false).finally(() => setBusy(false));
            setPendingDisable(null);
          },
        }}
      />
    </Screen>
  );
}

const TONE: Record<string, RowIconTone> = {
  assistant: 'purple',
  profile: 'blue',
  bots: 'grey',
  wallet: 'green',
  browser: 'teal',
  markets: 'orange',
};
