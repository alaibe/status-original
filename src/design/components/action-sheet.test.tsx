import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { ActionSheet, type SheetAction } from './action-sheet';

jest.mock('./sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
  closeSheetThen: (_sheet: unknown, action: () => void) => action(),
}));

const action = (label: string): SheetAction => ({ label, onPress: () => {} });

const TOKENS = ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'AERO', 'LINK', 'ETH', 'ARB'];

function render(actions: SheetAction[]) {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(ActionSheet, {
        visible: true,
        onClose: () => {},
        actions,
        searchFor: 'tokens',
      })
    );
  });
  return tree!;
}

/** `deep: false` keeps the row itself, not the elements it wraps. */
const labels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) => typeof node.props.accessibilityLabel === 'string' && Boolean(node.props.onPress),
      { deep: false }
    )
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => label !== 'Clear search');

const search = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.testID === 'sheet-search')[0];

describe('a sheet that picks one of several', () => {
  it('stays a plain list while it is short enough to read', () => {
    const tree = render(['ETH', 'USDC'].map(action));

    expect(tree.root.findAll((node) => node.props.testID === 'sheet-search')).toHaveLength(0);
    expect(labels(tree)).toEqual(['ETH', 'USDC']);
  });

  it('offers a search once the list is long', () => {
    const tree = render(TOKENS.map(action));
    expect(search(tree).props.placeholder).toBe('Search tokens');
  });

  it('keeps what matches, wherever it matches, ignoring case', () => {
    const tree = render(TOKENS.map(action));

    act(() => search(tree).props.onChangeText('bt'));
    expect(labels(tree)).toEqual(['WBTC']);

    act(() => search(tree).props.onChangeText('ET'));
    expect(labels(tree)).toEqual(['WETH', 'ETH']);
  });

  it('says so rather than showing an empty sheet', () => {
    const tree = render(TOKENS.map(action));

    act(() => search(tree).props.onChangeText('zzz'));
    expect(labels(tree)).toEqual([]);
    expect(JSON.stringify(tree.toJSON())).toContain('Nothing matches');
  });

  it('brings everything back when the search is cleared', () => {
    const tree = render(TOKENS.map(action));

    act(() => search(tree).props.onChangeText('dai'));
    expect(labels(tree)).toEqual(['DAI']);

    act(() => search(tree).props.onClear());
    expect(labels(tree)).toHaveLength(TOKENS.length);
  });
});
