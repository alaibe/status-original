import { Stack } from 'expo-router';

import { useState } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';

import {
  Badge,
  cn,
  ConfirmSheet,
  Eyebrow,
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

  const [pendingDisable, setPendingDisable] = useState<{
    plugin: Plugin;
    loss: BotChatLoss;
  } | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const apply = async (plugin: Plugin, next: boolean) => {
    const id = plugin.manifest.id;
    const done = `${plugin.manifest.name} ${next ? 'enabled' : 'disabled'}`;
    setToggling((current) => ({ ...current, [id]: next }));
    try {
      await setEnabled(id, next);
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update plugin'));
    } finally {
      setToggling(({ [id]: _settled, ...rest }) => rest);
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
            const enabled = toggling[plugin.manifest.id] ?? enabledIds.includes(plugin.manifest.id);
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
                  <View {...keepClickOffRow}>
                    <Switch
                      value={enabled}
                      onValueChange={(next) => onToggle(plugin, next)}
                      trackColor={{ true: colors.brand, false: colors.line }}
                      accessibilityLabel={`${enabled ? 'Disable' : 'Enable'} ${plugin.manifest.name}`}
                    />
                  </View>
                }
                onPress={() => setDetail(plugin)}
              />
            );
          })}
        </Section>
      </ScrollView>

      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.manifest.name}
        subtitle={detail ? `v${detail.manifest.version}` : undefined}
        leading={
          detail ? (
            <RowIcon name={detail.manifest.icon} tone={TONE[detail.manifest.id] ?? 'grey'} />
          ) : undefined
        }>
        <View className="gap-3">
          <Text variant="footnote">{detail?.manifest.description}</Text>

          <View className="gap-1.5">
            <Eyebrow>What it can reach</Eyebrow>
            <View
              style={{ borderCurve: 'continuous' }}
              className="overflow-hidden rounded-card bg-surface-raised">
              {detail?.manifest.permissions.map((permission, i) => (
                <Text
                  key={permission}
                  variant="footnote"
                  className={cn('px-4 py-2.5', i > 0 && 'border-t border-line')}>
                  {PERMISSION_LABELS[permission]}
                </Text>
              ))}
            </View>
          </View>

          {detail?.manifest.requiresSessionRestart || detailHasChat ? (
            <View className="flex-row flex-wrap gap-1.5">
              {detail?.manifest.requiresSessionRestart ? (
                <Badge label="Reconnects chat" tone="warning" />
              ) : null}
              {detailHasChat ? <Badge label="Has its own chat" tone="brand" /> : null}
            </View>
          ) : null}

          {detailHasChat ? (
            <Text variant="caption">
              Turning this off takes its chat out of your list. The transcript stays on this device
              and returns if you turn it back on.
            </Text>
          ) : null}
        </View>
      </Sheet>

      <ConfirmSheet
        visible={pendingDisable !== null}
        onClose={() => setPendingDisable(null)}
        title={copy?.title}
        body={copy?.body}
        cancelLabel="Keep it on"
        confirm={{
          label: copy?.confirmLabel ?? 'Turn off',
          tone: 'danger',
          onPress: () => {
            if (!pendingDisable) return;
            setPendingDisable(null);
            void apply(pendingDisable.plugin, false);
          },
        }}
      />
    </Screen>
  );
}

// react-native-web delivers the switch's click to the row's onPress as well.
const keepClickOffRow =
  Platform.OS === 'web' ? { onClick: (e: { stopPropagation(): void }) => e.stopPropagation() } : {};

const TONE: Record<string, RowIconTone> = {
  assistant: 'purple',
  profile: 'blue',
  bots: 'grey',
  wallet: 'green',
  browser: 'teal',
  markets: 'orange',
};
