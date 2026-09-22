import { act, createElement } from 'react';
import { StyleSheet } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { EmojiGrid, searchEmoji } from './emoji-grid';

jest.mock('@/design', () => ({
  Text: 'Text',
  Icon: 'Icon',
  SearchField: 'SearchField',
  useThemeColors: () => ({ brand: '#00f', 'content-muted': '#666', 'content-subtle': '#999' }),
}));

const saved = new Map<string, unknown>();
const mockStorage = {
  get: jest.fn(async (key: string) => saved.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown) => void saved.set(key, value)),
};
jest.mock('@/core/messaging/chat-store', () => ({
  useChatStore: (select: (state: { accountStorage: typeof mockStorage }) => unknown) =>
    select({ accountStorage: mockStorage }),
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
let tree: ReactTestRenderer;
const onEmoji = jest.fn();

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const mount = (width: number) =>
  act(async () => {
    tree = create(createElement(EmojiGrid, { width, onEmoji }));
    await nextTask();
  });
const headers = () =>
  tree.root
    .findAllByType('Text' as never)
    .map((node) => node.props.children)
    .filter((text): text is string => typeof text === 'string' && !/[\p{Emoji}]/u.test(text));
// A pressable shows up once per layer it renders through; its onPress identifies it.
const pressables = (role: string) => {
  const seen = new Set<unknown>();
  return tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === role &&
      typeof node.props.onPress === 'function' &&
      !seen.has(node.props.onPress) &&
      Boolean(seen.add(node.props.onPress))
  );
};
const tabs = () => pressables('tab');
const buttons = () => pressables('button');

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
afterEach(async () => {
  await act(() => tree?.unmount());
  saved.clear();
  onEmoji.mockClear();
});

describe('searchEmoji', () => {
  it('matches names and keywords, every term of the query', () => {
    expect(searchEmoji('heart')).toContain('❤️');
    expect(searchEmoji('red heart')).toEqual(['❤️']);
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('zzzz-nothing')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(searchEmoji('face', 3)).toHaveLength(3);
  });
});

describe('EmojiGrid', () => {
  it('lays the grid out in as many 40pt columns as the width holds', async () => {
    await mount(380);
    const [firstCell] = buttons();
    expect(StyleSheet.flatten(firstCell.props.style)).toMatchObject({
      width: (380 - 16) / 9,
      height: 40,
    });
    expect(headers()[0]).toBe('Smileys & Emotion');
    expect(tabs()).toHaveLength(9);
  });

  it('inserts the emoji, remembers it and shows it first next time', async () => {
    await mount(380);
    await act(async () => {
      buttons()[0].props.onPress();
      await nextTask();
    });

    expect(onEmoji).toHaveBeenCalledWith('😀');
    expect(mockStorage.set).toHaveBeenCalledWith('chat.recentEmoji', ['😀']);
    expect(headers()[0]).toBe('Recently used');
    expect(tabs()).toHaveLength(10);
    expect(tabs()[0].props.accessibilityLabel).toBe('Recently used');

    await act(() => tree.unmount());
    await mount(380);
    expect(headers()[0]).toBe('Recently used');
    expect(buttons()[0].props.accessibilityLabel).toBe('😀');
  });

  it('keeps the most recent first without duplicates', async () => {
    saved.set('chat.recentEmoji', ['😀', '🎉']);
    await mount(380);
    const party = buttons().find((node) => node.props.accessibilityLabel === '🎉')!;
    await act(async () => {
      party.props.onPress();
      await nextTask();
    });
    expect(mockStorage.set).toHaveBeenLastCalledWith('chat.recentEmoji', ['🎉', '😀']);
  });
});
