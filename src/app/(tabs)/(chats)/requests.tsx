import { Stack, useRouter } from 'expo-router';

import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { EmptyState, ListItem, Screen, SwipeableRow } from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import { formatTimestamp, messagePreview } from '@/core/messaging/preview';
import { decideConsent } from '@/features/chat/consent';
import { ConversationAvatar } from '@/features/chat/conversation-avatar';
import { conversationTitle, useDisplayNames, usePeers } from '@/features/chat/use-display-names';

export default function RequestsScreen() {
  const router = useRouter();

  const sessions = useChatStore((s) => s.sessions);
  const conversations = useChatStore((s) => s.conversations);
  const requests = useMemo(
    () => conversations.filter((c) => c.consent === 'unknown'),
    [conversations]
  );

  const { nameFor } = useDisplayNames(usePeers(requests));

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen options={{ title: 'Message requests' }} />

      {requests.length === 0 ? (
        <EmptyState title="Nothing waiting" description="New conversations will show up here." />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const selfId = selfIdFor({ sessions }, item.protocol);
            return (
              <SwipeableRow
                left={[
                  {
                    id: 'accept',
                    label: 'Accept',
                    icon: 'checkmark-circle-outline',
                    tone: 'brand',
                    onPress: () => decideConsent(item.id, 'allowed'),
                  },
                ]}
                right={[
                  {
                    id: 'ignore',
                    label: 'Ignore',
                    icon: 'close-circle-outline',
                    destructive: true,
                    onPress: () => decideConsent(item.id, 'denied'),
                  },
                ]}>
                <ListItem
                  testID={`request-${item.id}`}
                  title={conversationTitle(item, selfId, nameFor)}
                  subtitle={messagePreview(item.lastMessage)}
                  meta={item.lastMessage ? formatTimestamp(item.lastMessage.sentAt) : undefined}
                  leading={<ConversationAvatar conversation={item} selfId={selfId} size="md" />}
                  onPress={() => router.push(`/chat/${item.id}`)}
                />
              </SwipeableRow>
            );
          }}
        />
      )}
    </Screen>
  );
}
