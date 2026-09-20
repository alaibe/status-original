import type { PluginContext } from '@/core/plugins/types';

export interface EndpointSetting {
  hydrate(context: PluginContext): Promise<void>;
  current(): string;
  save(context: PluginContext, url: string | null): Promise<void>;
  isDefault(url: string): boolean;
}

/** A stored endpoint URL, read once at hydrate time and kept in memory after. */
export function createEndpointSetting({
  key,
  fallback,
}: {
  key: string;
  fallback: string;
}): EndpointSetting {
  let cached = fallback;

  return {
    async hydrate(context) {
      cached = (await context.storage.get<string>(key)) ?? fallback;
    },
    current: () => cached,
    async save(context, url) {
      cached = url ?? fallback;
      if (url) await context.storage.set(key, url);
      else await context.storage.remove(key);
    },
    isDefault: (url) => url === fallback,
  };
}
