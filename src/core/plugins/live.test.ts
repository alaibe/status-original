import type { PluginContext } from './types';
import { liveViews, notifyLiveViews, useLiveViews } from './live';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const version = (id: string) => useLiveViews.getState().versions[id] ?? 0;

describe('notifyLiveViews', () => {
  it('bumps a plugin once per task however many writes landed, and leaves the others alone', async () => {
    const a = version('a');
    const b = version('b');

    notifyLiveViews('a');
    notifyLiveViews('a');
    notifyLiveViews('a');
    expect(version('a')).toBe(a);

    await tick();
    expect(version('a')).toBe(a + 1);
    expect(version('b')).toBe(b);
  });
});

describe('liveViews', () => {
  const context = { manifest: { id: 'p' } } as PluginContext;
  const card = (text: string) => ({
    kind: 'widget' as const,
    widget: { kind: 'text' as const, text },
    fallback: text,
  });

  it('stamps each card with the view it came from, args included only when given', async () => {
    const views = liveViews(context, {
      list: () => card('list'),
      one: async ([id]) => card(`one ${id}`),
    });

    expect(await views.list()).toEqual({ ...card('list'), live: { pluginId: 'p', view: 'list' } });
    expect(await views.one(['x'])).toEqual({
      ...card('one x'),
      live: { pluginId: 'p', view: 'one', args: ['x'] },
    });
  });
});
