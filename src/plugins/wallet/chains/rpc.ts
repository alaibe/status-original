import { createPublicClient, http } from 'viem';

import type { PluginContext } from '@/core/plugins/types';

import { chainById, setRpcOverride } from '@/lib/evm/chains';
import { readRpcOverrides, writeRpcOverrides } from './rpc-storage';
import type { RpcCheck } from './strategy';

export async function hydrateRpcOverrides(context: PluginContext): Promise<void> {
  const saved = await readRpcOverrides(context);
  for (const [chainId, url] of Object.entries(saved)) {
    setRpcOverride(Number(chainId), url);
  }
}

export async function checkRpcUrl(chainId: number, url: string): Promise<RpcCheck> {
  const chain = chainById(chainId);
  if (!chain) return { ok: false, reason: `Unsupported chain ${chainId}.` };

  if (!/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
    return { ok: false, reason: 'The endpoint must start with https:// or wss://.' };
  }

  try {
    const probe = createPublicClient({ chain, transport: http(url) });
    const reported = await probe.getChainId();

    if (reported !== chainId) {
      const actual = chainById(reported);
      return {
        ok: false,
        reason:
          `That endpoint serves chain ${reported}${actual ? ` (${actual.name})` : ''}, ` +
          `not ${chain.name}, so it was not saved. The wrong network would give you ` +
          'wrong balances and could broadcast transactions to the wrong chain.',
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? `Could not reach it: ${error.message}` : 'Could not reach it.',
    };
  }
}

export async function saveRpcOverride(
  context: PluginContext,
  chainId: number,
  url: string | null
): Promise<void> {
  const saved = await readRpcOverrides(context);
  if (url) saved[String(chainId)] = url;
  else delete saved[String(chainId)];

  await writeRpcOverrides(context, saved);
  setRpcOverride(chainId, url);
}
