import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import { useKeyedLoad } from './use-keyed-load';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let tree: ReactTestRenderer;
let seen: ReturnType<typeof useKeyedLoad<string>>;

function Probe(props: {
  id: string | null;
  load: (key: string) => Promise<string>;
  v?: number;
  onResult: (result: typeof seen) => void;
}) {
  props.onResult(useKeyedLoad(props.id, props.load, props.v));
  return null;
}

const render = (props: Omit<Parameters<typeof Probe>[0], 'onResult'>) =>
  act(async () => {
    const element = createElement(Probe, { ...props, onResult: (result) => (seen = result) });
    if (tree) tree.update(element);
    else tree = create(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

describe('useKeyedLoad', () => {
  it('loads per key, drops a stale answer, and reloads for a new version', async () => {
    const slow: ((value: string) => void)[] = [];
    const load = jest.fn(
      (key: string) =>
        new Promise<string>((resolve) =>
          key === 'a' && slow.length === 0 ? slow.push(resolve) : resolve(`value of ${key}`)
        )
    );

    await render({ id: 'a', load });
    expect(seen.loading).toBe(true);
    await render({ id: 'b', load });
    await act(async () => slow[0]('stale a'));
    expect(seen.value).toBe('value of b');

    await render({ id: 'b', load, v: 2 });
    expect(load).toHaveBeenLastCalledWith('b');
    expect(load).toHaveBeenCalledTimes(3);

    await act(async () => seen.update((value) => `${value}!`));
    expect(seen.value).toBe('value of b!');
  });

  it('keeps one load when the loader is a new function each render', async () => {
    const load = jest.fn(async (key: string) => key);
    await render({ id: 'c', load });
    await render({ id: 'c', load: (key) => load(key) });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks nothing without a key', async () => {
    const load = jest.fn(async (key: string) => key);
    await render({ id: null, load });
    expect(load).not.toHaveBeenCalled();
    expect(seen.loading).toBe(false);
  });
});
