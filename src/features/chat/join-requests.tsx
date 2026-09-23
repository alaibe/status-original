import { View } from 'react-native';

import { Avatar, IconButton, ListItem, Section, Text } from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import { formatDayLabel } from '@/core/messaging/preview';
import type { ParticipantId } from '@/core/messaging/types';
import { useKeyedLoad } from '@/lib/use-keyed-load';

import { useAction } from './use-action';

export function JoinRequests({
  conversationId,
  pending,
}: {
  conversationId: string;
  pending?: number;
}) {
  const getJoinRequests = useChatStore((s) => s.getJoinRequests);
  const processJoinRequest = useChatStore((s) => s.processJoinRequest);
  const requests = useKeyedLoad(conversationId, getJoinRequests, pending);
  const answer = useAction(
    async (userId: ParticipantId, approve: boolean) => {
      await processJoinRequest(conversationId, userId, approve);
      requests.update((pending) => pending.filter((request) => request.userId !== userId));
    },
    { success: 'Done', failure: 'Could not handle join request' }
  );

  const note = requests.error
    ? errorMessage(requests.error, 'Could not load join requests')
    : requests.loading
      ? 'Loading requests…'
      : requests.value?.length === 0
        ? 'No pending requests'
        : null;

  return (
    <Section title="Join requests" surface="card" className="mb-5">
      {note ? (
        <Text variant="caption" className={requests.error ? 'px-4 py-3 text-danger' : 'px-4 py-3'}>
          {note}
        </Text>
      ) : (
        requests.value?.map((request) => (
          <ListItem
            key={request.userId}
            title={request.name}
            subtitle={request.bio || formatDayLabel(request.requestedAt)}
            numberOfLinesSubtitle={2}
            leading={<Avatar seed={request.userId} size="sm" />}
            trailing={
              <View className="flex-row">
                <IconButton
                  icon="checkmark"
                  label={`Approve ${request.name}`}
                  tone="brand"
                  disabled={answer.busy}
                  onPress={() => void answer.run(request.userId, true)}
                />
                <IconButton
                  icon="close"
                  label={`Decline ${request.name}`}
                  disabled={answer.busy}
                  onPress={() => void answer.run(request.userId, false)}
                />
              </View>
            }
          />
        ))
      )}
    </Section>
  );
}
