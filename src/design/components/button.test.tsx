import { Button } from './button';

/**
 * `Button` takes `onPress`, `disabled` and `haptic` out of its props and
 * spreads what is left onto the Pressable, so anything it destructures and
 * forgets to hand over is dropped silently: the button renders, springs on
 * touch and does nothing.
 *
 * It is a plain function with no hooks, so calling it and reading the element
 * it returns is enough. That avoids a renderer, which React 19 has taken away
 * anyway.
 */
const render = (props: Parameters<typeof Button>[0]) =>
  Button(props) as unknown as { props: Record<string, unknown> };

describe('Button', () => {
  it('passes onPress through to the pressable', () => {
    const onPress = jest.fn();
    const element = render({ label: 'Save', onPress });

    (element.props.onPress as (e: unknown) => void)({});

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onPress = jest.fn();
    const element = render({ label: 'Save', onPress, disabled: true });

    expect(element.props.onPress).toBeUndefined();
    expect(element.props.disabled).toBe(true);
  });

  it('does not fire while loading', () => {
    // A second tap on a button that is already working is the classic way to
    // send the same thing twice.
    const onPress = jest.fn();
    const element = render({ label: 'Save', onPress, loading: true });

    expect(element.props.onPress).toBeUndefined();
    expect(element.props.disabled).toBe(true);
  });

  it('announces itself as a button, with its state', () => {
    const element = render({ label: 'Save', loading: true });

    expect(element.props.accessibilityRole).toBe('button');
    expect(element.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('gives the compact size a 44pt touch target', () => {
    // The small button draws below the minimum, so the slop is the only thing
    // making it reachable.
    expect(render({ label: 'x', size: 'sm' }).props.hitSlop).toBeDefined();
    expect(render({ label: 'x', size: 'md' }).props.hitSlop).toBeUndefined();
  });
});
