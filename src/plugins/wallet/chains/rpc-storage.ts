import type { PluginContext } from '@/core/plugins/types';

const STORAGE_RPC = 'rpc-overrides';

export async function readRpcOverrides(context: PluginContext): Promise<Record<string, string>> {
  return (await context.storage.get<Record<string, string>>(STORAGE_RPC)) ?? {};
}

export async function writeRpcOverrides(
  context: PluginContext,
  overrides: Record<string, string>
): Promise<void> {
  await context.storage.set(STORAGE_RPC, overrides);
}
