import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { MemberModeration } from './group-sections';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/design', () => ({
  ActionSheet: 'ActionSheet',
  Card: 'Card',
  ConfirmSheet: 'ConfirmSheet',
  copyText: jest.fn(),
  ListItem: 'ListItem',
  Pressable: 'Pressable',
  RowIcon: 'RowIcon',
  Section: 'Section',
  Text: 'Text',
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockStore = {
  getMembers: jest.fn(async () => [{ id: 'bob', role: 'member' as const }]),
  removeMembers: jest.fn(async () => {}),
  banMember: jest.fn(async () => {}),
  setMemberMuted: jest.fn(async () => {}),
};
jest.mock('@/core/messaging/chat-store', () => ({
  useChatStore: (select: (state: typeof mockStore) => unknown) => select(mockStore),
}));
let mockSupported = ['setMemberMuted', 'banMember'];
jest.mock('./use-supports', () => ({
  useSupports: () => ({ supports: (key: string) => mockSupported.includes(key) }),
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let tree: ReactTestRenderer;
const onRemoved = jest.fn();

const mount = () =>
  act(async () => {
    tree = create(
      createElement(MemberModeration, {
        conversationId: 'telegram-5',
        member: 'bob',
        memberName: 'Bob',
        groupTitle: 'Builders',
        onRemoved,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const row = (testID: string) => tree.root.findByProps({ testID });
const rows = () =>
  tree.root.findAllByType('ListItem' as never).map((node) => node.props.testID as string);
const confirm = () => tree.root.findByType('ConfirmSheet' as never);

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(() => tree?.unmount());
  jest.clearAllMocks();
  mockSupported = ['setMemberMuted', 'banMember'];
});

describe('MemberModeration', () => {
  it('offers only what the network can do', async () => {
    await mount();
    expect(rows()).toEqual(['profile-mute-member', 'profile-remove-member', 'profile-ban-member']);
    await act(() => tree.unmount());
    mockSupported = [];
    await mount();
    expect(rows()).toEqual(['profile-remove-member']);
  });

  it('mutes, then offers to let them send again', async () => {
    await mount();
    await act(async () => row('profile-mute-member').props.onPress());
    expect(mockStore.setMemberMuted).toHaveBeenCalledWith('telegram-5', 'bob', true);
    expect(row('profile-mute-member').props.title).toBe('Let them send messages');
  });

  it('bans only once confirmed, then leaves the profile', async () => {
    await mount();
    await act(async () => row('profile-ban-member').props.onPress());
    expect(confirm().props.visible).toBe(true);
    expect(confirm().props.title).toBe('Ban Bob from Builders?');
    expect(mockStore.banMember).not.toHaveBeenCalled();

    await act(async () => confirm().props.confirm.onPress());
    expect(mockStore.banMember).toHaveBeenCalledWith('telegram-5', 'bob');
    expect(mockStore.removeMembers).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalled();
  });
});
