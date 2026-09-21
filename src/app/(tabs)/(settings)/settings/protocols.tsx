import { Stack, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Chevron,
  ListItem,
  RowIcon,
  Screen,
  Section,
  Text,
  type IconName,
  type RowIconTone,
} from '@/design';
import { useChatStore, type ProtocolConnection } from '@/core/messaging/chat-store';
import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { PROTOCOLS } from '@/protocols';

export default function ProtocolsScreen() {
  const router = useRouter();
  const connections = useChatStore((s) => s.protocols);

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Protocols' }} />

      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}>
        <View className="gap-1 px-gutter pb-4">
          <Text variant="bodyMuted">
            Every configured protocol connects at once and shares one inbox. Each conversation
            stays on the protocol it started on, and they do not offer the same guarantees.
          </Text>
        </View>

        <Section surface="card" className="mb-6">
          {PROTOCOLS.map((descriptor) => {
            const status = describeStatus(descriptor, connections[descriptor.id]);
            return (
              <ListItem
                key={descriptor.id}
                testID={`protocol-${descriptor.id}`}
                title={descriptor.label}
                subtitle={connections[descriptor.id]?.error ?? descriptor.description}
                numberOfLinesSubtitle={2}
                leading={<RowIcon name={ICON[descriptor.id] ?? 'git-network-outline'} tone={TONE[descriptor.id] ?? 'grey'} />}
                meta={<Badge label={status.label} tone={status.tone} />}
                trailing={<Chevron />}
                onPress={() => router.push(`/settings/protocol/${descriptor.id}`)}
              />
            );
          })}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const TONE: Record<string, RowIconTone> = {
  xmtp: 'blue',
  nostr: 'purple',
  waku: 'teal',
  telegram: 'blue',
};

const ICON: Record<string, IconName> = {
  xmtp: 'shield-checkmark-outline',
  nostr: 'flash-outline',
  waku: 'radio-outline',
  telegram: 'paper-plane-outline',
};

function describeStatus(
  descriptor: ProtocolDescriptor,
  connection: ProtocolConnection | undefined
): { label: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' } {
  if (!descriptor.connect) return { label: 'Not available', tone: 'neutral' };
  if (connection?.login) return { label: 'Sign in', tone: 'warning' };

  switch (connection?.status) {
    case 'ready':
      return { label: 'Connected', tone: 'success' };
    case 'connecting':
      return { label: 'Connecting', tone: 'brand' };
    case 'error':
      return { label: 'Failed', tone: 'danger' };
    default:
      return { label: 'Not set up', tone: 'neutral' };
  }
}
