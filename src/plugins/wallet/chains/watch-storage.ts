import type { PluginContext } from '@/core/plugins/types';

import type { Address } from 'viem';

export interface WatchedAddress {
  address: Address;
  label: string;
  addedAt: number;
}

const watchedKey = (chainId: number) => `watched:${chainId}`;

export async function readWatched(
  context: PluginContext,
  chainId: number
): Promise<WatchedAddress[]> {
  return (await context.storage.get<WatchedAddress[]>(watchedKey(chainId))) ?? [];
}

export async function writeWatched(
  context: PluginContext,
  chainId: number,
  list: WatchedAddress[]
): Promise<void> {
  await context.storage.set(watchedKey(chainId), list);
}

const STORAGE_SEEN_BALANCES = 'bot-seen-balances';

export async function readSeenBalances(context: PluginContext): Promise<Record<string, string>> {
  return (await context.storage.get<Record<string, string>>(STORAGE_SEEN_BALANCES)) ?? {};
}

export async function writeSeenBalances(
  context: PluginContext,
  seen: Record<string, string>
): Promise<void> {
  await context.storage.set(STORAGE_SEEN_BALANCES, seen);
}
