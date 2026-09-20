import { createEndpointSetting } from '@/core/plugins/endpoint-setting';
import { DEFAULT_API_BASE } from './api';

const setting = createEndpointSetting({ key: 'api-base', fallback: DEFAULT_API_BASE });

export const apiBase = setting.current;
export const hydrateApiBase = setting.hydrate;
export const saveApiBase = setting.save;
export const isDefaultApiBase = setting.isDefault;
