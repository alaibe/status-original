import { ActivityIndicator, View } from 'react-native';

import { useChatStore } from '@/core/messaging/chat-store';
import { Pressable, Text, useThemeColors } from '@/design';
import { protocolLabel } from '@/features/protocols/presentation';

/** Shared by the inbox and the oldest end of a conversation's transcript. */
export function HistoryStatus({ protocol }: { protocol?: string }) {
  const colors = useThemeColors();
  const protocols = useChatStore((s) => s.protocols);
  const syncProtocol = useChatStore((s) => s.syncProtocol);
  const entries = Object.entries(protocols).filter(([id]) => !protocol || id === protocol);
  const fetching = entries.filter(([, state]) => state.history?.status === 'fetching');
  const connecting = entries.filter(([, state]) => state.status === 'connecting');
  const failed = entries.filter(([, state]) => state.history?.status === 'error');
  const partial = entries.filter(([, state]) => state.history?.status === 'partial');
  const active = [
    ...fetching,
    ...connecting.filter(([id]) => !fetching.some(([key]) => key === id)),
  ];

  if (active.length === 0 && failed.length === 0 && partial.length === 0) return null;

  return (
    <View className="gap-1 px-gutter py-3" accessibilityLiveRegion="polite">
      {active.length > 0 ? (
        <View
          className="flex-row items-center gap-2"
          accessible
          accessibilityLabel={`${fetching.length ? 'Fetching history' : 'Connecting'}: ${active.map(([id]) => protocolLabel(id)).join(', ')}`}>
          <ActivityIndicator size="small" color={colors['content-subtle']} />
          <Text variant="caption" className="flex-1">
            {fetching.length ? 'Fetching history…' : 'Connecting…'}
            {' · '}
            {active.map(([id]) => protocolLabel(id)).join(' · ')}
          </Text>
        </View>
      ) : null}
      {failed.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry fetching history. ${details(failed)}`}
          onPress={() => {
            for (const [id] of failed) void syncProtocol(id);
          }}
          className="py-1">
          <Text variant="caption">{details(failed)} · Retry</Text>
        </Pressable>
      ) : null}
      {partial.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry unavailable relays. ${details(partial)}`}
          onPress={() => {
            for (const [id] of partial) void syncProtocol(id);
          }}
          className="py-1">
          <Text variant="caption">{details(partial)} · Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function details(entries: [string, { history?: { error?: string } }][]): string {
  return entries
    .map(([id, state]) => `${protocolLabel(id)}: ${state.history?.error ?? 'History unavailable'}`)
    .join(' · ');
}
