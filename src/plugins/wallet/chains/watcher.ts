import { formatEther, type Address, type Chain } from 'viem';

import { shortAddress } from '@/core/identity/keyring';
import type { MessageContent } from '@/core/messaging/types';
import type { PluginContext } from '@/core/plugins/types';
import { chainSlug, publicClientFor } from '@/lib/evm/chains';

import { balanceChangeCard } from './balance-change';
import type { Say } from './strategy';
import { readSeenBalances, readWatched, writeSeenBalances } from './watch-storage';

interface Target {
  address: Address;
  label: string;
}

export async function checkBalances(chain: Chain, context: PluginContext, say: Say): Promise<void> {
  const targets = watchTargetsOf(context, await readWatched(context, chain.id));
  if (targets.length === 0) return;

  const seen = await readSeenBalances(context);
  const client = publicClientFor(chain.id);
  const balances = await Promise.all(
    targets.map((target) => client.getBalance({ address: target.address }).catch(() => null))
  );

  const next: Record<string, string> = {};
  const changes: { target: Target; previous: bigint; current: bigint }[] = [];

  targets.forEach((target, i) => {
    const key = balanceKey(chain.id, target.address);
    const balance = balances[i];
    if (balance === null) {
      if (seen[key] !== undefined) next[key] = seen[key];
      return;
    }

    const previous = seen[key];
    next[key] = balance.toString();

    if (previous === undefined || BigInt(previous) === balance) return;
    changes.push({ target, previous: BigInt(previous), current: balance });
  });

  if (Object.entries(next).some(([key, value]) => seen[key] !== value)) {
    await writeSeenBalances(context, { ...seen, ...next });
  }
  for (const change of changes) await say(balanceChangeMessage({ chain, ...change }));
}

function watchTargetsOf(
  context: PluginContext,
  watched: { address: Address; label: string }[]
): Target[] {
  const targets: Target[] = [];

  try {
    targets.push({ address: context.identity.address, label: 'You' });
  } catch {
  }

  const seen = new Set(targets.map((t) => t.address.toLowerCase()));
  for (const entry of watched) {
    if (seen.has(entry.address.toLowerCase())) continue;
    seen.add(entry.address.toLowerCase());
    targets.push({ address: entry.address, label: entry.label });
  }

  return targets;
}

// Chain *and* address: one Wallet plugin holds every chain, so the same address
// on Base and Arbitrum would otherwise share a reading and announce each
// other's movements.
function balanceKey(chainId: number, address: Address): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export function balanceChangeMessage({
  chain,
  target,
  previous,
  current,
}: {
  chain: Chain;
  target: Target;
  previous: bigint;
  current: bigint;
}): MessageContent {
  const delta = current - previous;
  const received = delta > 0n;
  const symbol = chain.nativeCurrency.symbol;
  const headline = `${received ? '+' : '−'}${formatAmount(delta < 0n ? -delta : delta)} ${symbol}`;

  return balanceChangeCard({
    fallback: `${target.label}: ${headline} (now ${formatAmount(current)} ${symbol})`,
    title: received ? 'Funds received' : 'Balance went down',
    icon: 'diamond-outline',
    headline,
    label: target.label,
    caption: `Now ${formatAmount(current)} ${symbol} on ${chain.name}`,
    tone: received ? 'success' : 'warning',
    address: target.address,
    chain: chainSlug(chain.name),
    short: (address) => shortAddress(address),
  });
}

function formatAmount(wei: bigint): string {
  const value = Number(formatEther(wei));
  if (value === 0) return '0';
  if (value < 0.0001) return '<0.0001';
  return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
}
