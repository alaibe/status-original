import type { Address } from 'viem';

import type { PluginContext } from '@/core/plugins/types';
import { describeToken } from '@/lib/evm/tokens';
import type { ListedToken } from '@/lib/evm/token-list';

const STORAGE_TOKENS = 'custom-tokens';

type Saved = Record<string, ListedToken[]>;

/**
 * One blob holds every chain's, and a balance command asks chain by chain, so
 * it is read once. Held against the context, not the module, so another
 * account cannot be handed this one's tokens.
 */
const cached = new WeakMap<PluginContext, Promise<Saved>>();

function all(context: PluginContext): Promise<Saved> {
  const held = cached.get(context);
  if (held) return held;

  const reading = context.storage
    .get<Saved>(STORAGE_TOKENS)
    .then((saved) => saved ?? {})
    .catch(() => ({}) as Saved);
  cached.set(context, reading);
  return reading;
}

async function save(context: PluginContext, saved: Saved): Promise<void> {
  cached.set(context, Promise.resolve(saved));
  await context.storage.set(STORAGE_TOKENS, saved);
}

export async function readCustomTokens(
  context: PluginContext,
  chainId: number
): Promise<ListedToken[]> {
  return (await all(context))[String(chainId)] ?? [];
}

export async function addCustomToken(
  context: PluginContext,
  chainId: number,
  contract: Address
): Promise<ListedToken | null> {
  const token = await describeToken(chainId, contract);
  if (!token) return null;

  const saved = { ...(await all(context)) };
  const onChain = saved[String(chainId)] ?? [];
  const already = onChain.some((t) => t.address.toLowerCase() === contract.toLowerCase());

  if (!already) {
    saved[String(chainId)] = [...onChain, token];
    await save(context, saved);
  }
  return token;
}

export async function removeCustomToken(
  context: PluginContext,
  chainId: number,
  contract: Address
): Promise<boolean> {
  const saved = { ...(await all(context)) };
  const onChain = saved[String(chainId)] ?? [];
  const left = onChain.filter((t) => t.address.toLowerCase() !== contract.toLowerCase());
  if (left.length === onChain.length) return false;

  if (left.length) saved[String(chainId)] = left;
  else delete saved[String(chainId)];
  await save(context, saved);
  return true;
}
