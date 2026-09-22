import type { PluginContext } from '@/core/plugins/types';

import { createEndpointSetting } from '@/core/plugins/endpoint-setting';
import { DEFAULT_API_BASE } from './api';
import type { MarketAlert } from './alerts';

const STORAGE_ALERTS = 'alerts';

export async function readAlerts(context: PluginContext): Promise<MarketAlert[]> {
  return (await context.storage.get<MarketAlert[]>(STORAGE_ALERTS)) ?? [];
}

export async function writeAlerts(context: PluginContext, alerts: MarketAlert[]): Promise<void> {
  await context.storage.set(STORAGE_ALERTS, alerts);
}

const setting = createEndpointSetting({ key: 'api-base', fallback: DEFAULT_API_BASE });
export const isDefaultApiBase = setting.isDefault;

export const apiBase = setting.current;
export const hydrateApiBase = setting.hydrate;
export const saveApiBase = setting.save;
