import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { MessageId } from '@/core/messaging/types';
import { ConversationView } from '@/features/chat/conversation-view';
import { useBack } from '@/features/navigation/use-back';

const THREAD_PANE_WIDTH = 400;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const back = useBack('/chats');
  const [open, setOpen] = useState<{ id: string; root: MessageId } | null>(null);

  if (process.env.EXPO_OS !== 'web') {
    return (
      <ConversationView
        id={id}
        onBack={back}
        onOpenThread={(root) => router.push({ pathname: '/thread/[id]', params: { id, root } })}
      />
    );
  }

  // The desktop keeps the chat in view and opens the thread beside it.
  const root = open?.id === id ? open.root : undefined;
  return (
    <View className="flex-1 flex-row">
      <View className="min-w-0 flex-1">
        <ConversationView
          id={id}
          onBack={back}
          onOpenThread={(next) => setOpen({ id, root: next })}
        />
      </View>
      {root ? (
        <View
          style={{ width: THREAD_PANE_WIDTH, borderCurve: 'continuous' }}
          className="my-2 mr-2 overflow-hidden rounded-card bg-surface shadow-md">
          <ConversationView key={root} id={id} thread={root} onBack={() => setOpen(null)} />
        </View>
      ) : null}
    </View>
  );
}
