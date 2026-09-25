import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { useChatStore } from '@/core/messaging/chat-store';
import { useTypingAnnouncer } from './use-typing-announcer';

function Probe() {
  return createElement('probe', { announce: useTypingAnnouncer('chat', true) });
}

it('tells the network once per few seconds of typing, not on every keystroke', () => {
  jest.useFakeTimers();
  const setTyping = jest.fn(async () => {});
  useChatStore.setState({ setTyping });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(Probe));
  });
  const announce: (text: string) => void = tree.root.findByType('probe' as never).props.announce;

  for (const text of ['h', 'he', 'hel', 'hell', 'hello']) announce(text);
  expect(setTyping.mock.calls).toEqual([['chat', true]]);

  jest.advanceTimersByTime(3_000);
  announce('hello!');
  expect(setTyping.mock.calls).toEqual([
    ['chat', true],
    ['chat', true],
  ]);

  announce('');
  expect(setTyping.mock.calls.at(-1)).toEqual(['chat', false]);
  announce('');
  expect(setTyping).toHaveBeenCalledTimes(3);

  act(() => tree.unmount());
  jest.useRealTimers();
});
