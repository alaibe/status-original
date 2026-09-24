import { act, createElement, useEffect, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConversationScope } from '@/core/messaging/conversation-scope';

import { useCommandDispatch } from './use-command-dispatch';

const mockNoCommands: never[] = [];
jest.mock('@/core/plugins/host', () => ({
  usePluginHost: () => ({
    registry: {
      subscribe: () => () => {},
      commandListFor: () => mockNoCommands,
      commandsFor: () => new Map(),
      commands: () => new Map(),
      get: () => undefined,
    },
  }),
}));
jest.mock('@/core/plugins/registry', () => ({ worksOn: () => true }));
jest.mock('./use-supports', () => ({ useSupports: () => ({ session: undefined }) }));
jest.mock('@/core/messaging/chat-store', () => ({ useChatStore: { getState: () => ({}) } }));

let press: (command: string) => void = () => {};

function Chat({ send }: { send: (text: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [messages, setMessages] = useState(0);
  useEffect(() => {
    press = setPending;
  }, []);
  useCommandDispatch({
    conversationId: 'conv-1',
    scope: 'dm' as unknown as ConversationScope,
    onSendText: async (text) => {
      send(text);
      setMessages(messages + 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return '';
    },
    setDraft: () => {},
    onRunningChange: () => {},
    pendingCommand: pending,
    onPendingCommandHandled: () => setPending(null),
  });
  return null;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

describe('a /reply button', () => {
  let tree: ReactTestRenderer;
  afterEach(() => act(() => tree.unmount()));

  it('sends its text once, and again only when pressed again', async () => {
    const send = jest.fn();
    await act(async () => {
      tree = create(createElement(Chat, { send }));
    });

    await act(async () => press('/reply /week Decize'));
    await settle();
    await settle();
    expect(send.mock.calls).toEqual([['/week Decize']]);

    await act(async () => press('/reply /week Decize'));
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
