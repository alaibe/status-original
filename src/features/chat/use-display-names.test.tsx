import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { useDisplayNames } from './use-display-names';

function Probe() {
  const { nameFor } = useDisplayNames([{ id: '200', protocol: 'telegram' }]);
  return createElement('probe', { name: nameFor('200') });
}

it('shows a name another screen already looked up from the first frame', async () => {
  const resolveNames = jest.fn(async () => ({ '200': 'Bob Builder' }));
  const session = { resolveAddresses: async () => ({}), resolveNames } as unknown as ChatSession;
  useChatStore.setState({ accountId: 'account', sessions: { telegram: session } });

  let first!: ReactTestRenderer;
  await act(async () => {
    first = create(createElement(Probe));
  });
  expect(first.root.findByType('probe' as never).props.name).toBe('Bob Builder');
  act(() => first.unmount());

  const frames: string[] = [];
  function Recorder() {
    const { nameFor } = useDisplayNames([{ id: '200', protocol: 'telegram' }]);
    frames.push(nameFor('200'));
    return null;
  }
  let second!: ReactTestRenderer;
  await act(async () => {
    second = create(createElement(Recorder));
  });
  expect(frames[0]).toBe('Bob Builder');
  act(() => second.unmount());
});
