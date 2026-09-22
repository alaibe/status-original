import { colorsFor } from '../tokens';

/**
 * `className` resolves colours through NativeWind's CSS variables; the hook
 * resolves the same colours in JavaScript for the props that cannot take a
 * class (an icon's `color`, a `Switch`'s `trackColor`). When they disagree,
 * the result is white cards on a black conversation.
 *
 * The hook itself needs a renderer, so what is pinned here is that the two
 * schemes are different palettes, which makes reading the wrong one visible
 * every time.
 */
describe('the light and dark palettes', () => {
  it('differ on every surface and content colour', () => {
    const light = colorsFor('light');
    const dark = colorsFor('dark');

    for (const key of ['canvas', 'surface', 'surface-raised', 'content', 'bubble-in'] as const) {
      expect(light[key]).not.toBe(dark[key]);
    }
  });

  /**
   * Dark surfaces have to be darker than light ones. Obvious, and worth
   * asserting: the tokens are generated, and a regenerate that swapped the two
   * blocks would still typecheck and still render, just inverted.
   */
  it('puts dark on the dark side', () => {
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb
        .replace(/[^\d ]/g, '')
        .trim()
        .split(/\s+/)
        .map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    expect(luminance(colorsFor('dark').canvas)).toBeLessThan(luminance(colorsFor('light').canvas));
    expect(luminance(colorsFor('dark').content)).toBeGreaterThan(
      luminance(colorsFor('light').content)
    );
  });
});
