import { ListItem } from './list-item';

/**
 * React Native makes a `Pressable` a single accessibility element, which stops
 * iOS exposing the `Text` inside it, so a row announces nothing to VoiceOver
 * unless its label is rebuilt from the parts.
 *
 * Plain function, no hooks: calling it and reading the element back is enough,
 * which is how `button.test.tsx` does it and avoids needing a renderer.
 */
const render = (props: Parameters<typeof ListItem>[0]) =>
  ListItem(props) as unknown as { props: Record<string, unknown> };

describe('a tappable row', () => {
  it('announces its title and subtitle', () => {
    const element = render({ title: 'Recovery phrase', subtitle: 'View the words', onPress() {} });
    expect(element.props.accessibilityLabel).toBe('Recovery phrase, View the words');
  });

  it('announces just the title when there is no subtitle', () => {
    expect(render({ title: 'Accounts', onPress() {} }).props.accessibilityLabel).toBe('Accounts');
  });

  it('lets a caller say it better', () => {
    const element = render({
      title: 'Base',
      subtitle: '0.4 ETH',
      accessibilityLabel: 'Base, 0.4 ether',
      onPress() {},
    });
    expect(element.props.accessibilityLabel).toBe('Base, 0.4 ether');
  });

  /**
   * A chat row styles part of the name, so its title is a node. There is
   * nothing sensible to read out of one, and guessing would announce markup.
   */
  it('says nothing rather than guessing when the title is a node', () => {
    const element = render({ title: null, subtitle: 'Two people', onPress() {} });
    expect(element.props.accessibilityLabel).toBeUndefined();
  });
});
