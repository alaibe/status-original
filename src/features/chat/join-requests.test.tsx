import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { JoinRequests } from './join-requests';

jest.mock('@/design', () => ({
  Avatar: 'Avatar',
  IconButton: 'IconButton',
  ListItem: 'ListItem',
  Section: 'Section',
  Text: 'Text',
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockStore = {
  getJoinRequests: jest.fn(async () => [
    { userId: 'carol', name: 'Carol', bio: 'Friend of Bob', requestedAt: 1 },
    { userId: 'dan', name: 'Dan', requestedAt: 2 },
  ]),
  processJoinRequest: jest.fn(async () => {}),
};
jest.mock('@/core/messaging/chat-store', () => ({
  useChatStore: (select: (state: typeof mockStore) => unknown) => select(mockStore),
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let tree: ReactTestRenderer;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(() => tree?.unmount());
});

it('lists requests and drops each one once answered', async () => {
  await act(async () => {
    tree = create(createElement(JoinRequests, { conversationId: 'matrix-room' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const names = () => tree.root.findAllByType('ListItem' as never).map((n) => n.props.title);
  expect(names()).toEqual(['Carol', 'Dan']);

  const carol = tree.root.findAllByType('ListItem' as never)[0];
  const [approve] = carol.props.trailing.props.children;
  expect(approve.props.label).toBe('Approve Carol');
  await act(async () => approve.props.onPress());
  expect(mockStore.processJoinRequest).toHaveBeenCalledWith('matrix-room', 'carol', true);
  expect(names()).toEqual(['Dan']);
});
