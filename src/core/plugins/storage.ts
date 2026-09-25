import type { AccountStorage } from '@/storage/account';
import type { PluginId } from './types';

const PREFS_KEY = 'plugins.prefs';

export interface PluginPrefs {
  enabled: PluginId[];
}

export async function loadPluginPrefs(storage: AccountStorage): Promise<PluginPrefs | null> {
  const parsed = await storage.get<PluginPrefs>(PREFS_KEY);
  return Array.isArray(parsed?.enabled) ? parsed : null;
}

export async function savePluginPrefs(storage: AccountStorage, prefs: PluginPrefs): Promise<void> {
  await storage.set(PREFS_KEY, prefs);
}

export function resolveEnabledIds(params: {
  all: PluginId[];
  defaults: PluginId[];
  prefs: PluginPrefs | null;
}): PluginId[] {
  const { all, defaults, prefs } = params;
  return (prefs?.enabled ?? defaults).filter((id) => all.includes(id));
}
