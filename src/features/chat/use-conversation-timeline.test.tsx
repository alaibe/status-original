import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage } from '@/core/messaging/types';
import { useConversationTimeline } from './use-conversation-timeline';

jest.mock('expo-observe', () => ({ useObserve: () => ({ markInteractive: () => {} }) }));

const message = (id: string, threadRoot?: string): ChatMessage => ({
  id,
  conversationId: 'chat',
  senderId: 'me',
  sentAt: 1,
  content: { kind: 'text', text: id },
  fromMe: true,
  status: 'sent',
  threadRoot,
});

function Probe({ thread }: { thread?: string }) {
  const timeline = useConversationTimeline('chat', thread, undefined, undefined, true);
  return createElement('probe', {
    ids: timeline.messages.map((item) => item.id),
    replies: timeline.replyCounts.get('root'),
  });
}

it('shows root messages in the chat and only that root with its replies in a thread', () => {
  useChatStore.setState({
    accountId: null,
    messages: { chat: [message('root'), message('reply', 'root'), message('later')] },
    messageHistory: {},
    readAt: {},
  });

  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(Probe));
  });
  expect(tree.root.findByType('probe' as never).props).toEqual({
    ids: ['root', 'later'],
    replies: 1,
  });

  act(() => tree.update(createElement(Probe, { thread: 'root' })));
  expect(tree.root.findByType('probe' as never).props.ids).toEqual(['root', 'reply']);
  act(() => tree.unmount());
});

it('marks the chat read only when something arrived since it was last read', () => {
  const markRead = jest.fn(async () => {});
  const fromPeer = (id: string, sentAt: number): ChatMessage => ({
    ...message(id),
    senderId: 'peer',
    fromMe: false,
    sentAt,
  });
  useChatStore.setState({
    accountId: null,
    messages: { chat: [fromPeer('seen', 5)] },
    messageHistory: {},
    readAt: { chat: 10 },
    markRead,
  });

  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(Probe));
  });
  expect(markRead).not.toHaveBeenCalled();

  act(() =>
    useChatStore.setState({ messages: { chat: [fromPeer('seen', 5), fromPeer('new', 20)] } })
  );
  expect(markRead).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
