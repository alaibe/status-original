import { useLocalSearchParams } from 'expo-router';

import { ConversationView } from '@/features/chat/conversation-view';
import { useBack } from '@/features/navigation/use-back';

export default function ThreadScreen() {
  const { id, root } = useLocalSearchParams<{ id: string; root: string }>();
  const back = useBack(`/chat/${id}`);
  return <ConversationView id={id} thread={root} onBack={back} />;
}
