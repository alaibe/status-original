import { EmptyPane } from '@/features/navigation/empty-pane';

/** The list is in the sidebar; the pane waits for a conversation. */
export default function ChatsScreen() {
  return <EmptyPane hint="Select a chat to start messaging" />;
}
