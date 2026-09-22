import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

import type { WidgetContent } from '@/core/messaging/types';
import { notifyLiveViews } from '@/core/plugins/live';
import type { PluginView } from '@/core/plugins/types';
import type { Widget } from '@/design/widgets';

import { useLiveWidget } from './use-live-widget';

const mockViews = new Map<string, PluginView>();
const mockHost = {
  enabledIds: ['p'],
  registry: { view: (pluginId: string, name: string) => mockViews.get(`${pluginId}/${name}`) },
};
jest.mock('@/core/plugins/host', () => ({ usePluginHost: () => mockHost }));

const text = (value: string): Widget => ({ kind: 'text', text: value });
const card = (value: string) => ({ kind: 'widget' as const, widget: text(value), fallback: value });
const snapshot: WidgetContent = {
  ...card('then'),
  live: { pluginId: 'p', view: 'list', args: ['x'] },
};

function Probe({ content }: { content: WidgetContent }) {
  return createElement('probe', { widget: useLiveWidget(content) });
}

let tree: ReactTestRenderer;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = () => act(nextTask);
const mount = (content: WidgetContent) =>
  act(async () => {
    tree = create(createElement(Probe, { content }));
    await nextTask();
  });
const shown = () => tree.root.findByType('probe' as never).props.widget as Widget;

afterEach(async () => {
  await act(() => tree?.unmount());
  mockViews.clear();
});

describe('useLiveWidget', () => {
  it('rebuilds a card from its view, and again when its plugin changes', async () => {
    let state = 'now';
    const view = jest.fn(async (args: string[] = []) => card(`${state} for ${args[0]}`));
    mockViews.set('p/list', view);

    await mount(snapshot);
    expect(shown()).toEqual(text('now for x'));

    state = 'later';
    notifyLiveViews('p');
    await settle();
    expect(shown()).toEqual(text('later for x'));
    expect(view).toHaveBeenCalledTimes(2);
  });

  it('keeps the snapshot while the plugin has no such view', async () => {
    await mount(snapshot);
    expect(shown()).toEqual(text('then'));
  });

  it('keeps what it has when the view fails', async () => {
    mockViews.set('p/list', async () => {
      throw new Error('gone');
    });
    await mount(snapshot);
    expect(shown()).toEqual(text('then'));
  });

  it('ignores a change to another plugin', async () => {
    const view = jest.fn(async () => card('now'));
    mockViews.set('p/list', view);

    await mount(snapshot);
    notifyLiveViews('q');
    await settle();
    expect(view).toHaveBeenCalledTimes(1);
  });
});
