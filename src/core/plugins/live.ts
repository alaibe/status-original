import { create } from 'zustand';

import type { WidgetContent } from '../messaging/types';
import type { PluginContext, PluginId, PluginView } from './types';

export const useLiveViews = create<{ versions: Record<PluginId, number> }>(() => ({
  versions: {},
}));

const pending = new Set<PluginId>();
let scheduled = false;

export function notifyLiveViews(pluginId: PluginId): void {
  pending.add(pluginId);
  if (scheduled) return;
  scheduled = true;
  // A task later, the writer that triggered this has finished its own follow-up work.
  setTimeout(() => {
    scheduled = false;
    const bumped = [...pending];
    pending.clear();
    useLiveViews.setState((state) => {
      const versions = { ...state.versions };
      for (const id of bumped) versions[id] = (versions[id] ?? 0) + 1;
      return { versions };
    });
  }, 0);
}

type CardBuilder = (
  args: string[]
) => Promise<Omit<WidgetContent, 'live'>> | Omit<WidgetContent, 'live'>;

export function liveViews<K extends string>(
  context: PluginContext,
  builders: Record<K, CardBuilder>
): Record<K, PluginView> {
  const pluginId = context.manifest.id;
  const entries = Object.entries<CardBuilder>(builders).map(([view, build]) => [
    view,
    async (args: string[] = []) => ({
      ...(await build(args)),
      live: args.length > 0 ? { pluginId, view, args } : { pluginId, view },
    }),
  ]);
  return Object.fromEntries(entries) as Record<K, PluginView>;
}
