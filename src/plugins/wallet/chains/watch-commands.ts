import type { Address, Chain } from 'viem';

import type { PluginContext, PluginView, SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';
import { looksLikeEnsName, resolveName } from '@/lib/evm/ens';
import { shortAddress } from '@/core/identity/keyring';

import { publicClientFor, trimDecimals } from '@/lib/evm/chains';
import { formatEther } from 'viem';

import { readWatched, writeWatched, type WatchedAddress } from './watch-storage';

const formatAmount = (wei: bigint, symbol: string) => `${trimDecimals(formatEther(wei))} ${symbol}`;

async function targetAddress(
  input: string,
  self: () => Address
): Promise<{ address: Address; label: string } | { error: string }> {
  const value = input.trim();
  if (!value || value === 'me') return { address: self(), label: 'You' };

  if (looksLikeEnsName(value)) {
    const resolved = await resolveName(value);
    if (!resolved) return { error: `Could not resolve ${value}.` };
    return { address: resolved, label: value };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return { error: `"${value}" is not an address.` };
  return { address: value as Address, label: shortAddress(value as Address) };
}

export type ChainResolver = (
  args: string[]
) => Promise<{ chain: Chain; networkId: string; rest: string[] } | { error: string }>;

export async function watchedCard(context: PluginContext, chain: Chain, networkId: string) {
  const list = await readWatched(context, chain.id);

  if (list.length === 0) {
    return {
      kind: 'widget' as const,
      fallback: `Nothing watched on ${chain.name}`,
      widget: W.card(
        [
          W.text(`Nothing on your ${chain.name} watch list. Add one with /watch vitalik.eth`),
        ],
        { title: 'Watch list', icon: 'eye-outline' }
      ),
    };
  }

  const balances = await Promise.all(
    list.map(async (entry) => {
      try {
        const wei = await publicClientFor(chain.id).getBalance({ address: entry.address });
        return { entry, value: formatAmount(wei, chain.nativeCurrency.symbol) };
      } catch {
        return { entry, value: 'unavailable' };
      }
    })
  );

  return {
    kind: 'widget' as const,
    fallback: `Watching ${list.length} address${list.length === 1 ? '' : 'es'}`,
    widget: W.card(
      [
        W.rows(
          balances.map((b) => ({
            label: b.entry.label,
            value: b.value,
            actions: [
              {
                label: `Stop watching ${b.entry.label}`,
                command: `/unwatch ${b.entry.address} --chain ${networkId}`,
                icon: 'eye-off-outline' as const,
                tone: 'danger' as const,
              },
            ],
          }))
        ),
        W.text(`Balances on ${chain.name}. I say so here when one moves.`),
      ],
      { title: 'Watch list', icon: 'eye-outline' }
    ),
  };
}

export function watchCommands(
  resolve: ChainResolver,
  views: { watched: PluginView }
): SlashCommand[] {
  return [
  {
    name: 'watch',
    showIn: ['channel'],
    description: 'Track an address and hear when its balance moves',
    usage: '/watch <address | name.eth> [label] [--chain base]',
    async run({ args, context }) {
      const picked = await resolve(args);
      if ('error' in picked) return { type: 'error', message: picked.error };
      const { chain, rest } = picked;

      const [input, ...labelParts] = rest;
      if (!input) return { type: 'error', message: 'Give me an address: /watch vitalik.eth' };

      const target = await targetAddress(input, () => context.identity.address);
      if ('error' in target) return { type: 'error', message: target.error };

      const list = await readWatched(context, chain.id);
      if (list.some((w) => w.address.toLowerCase() === target.address.toLowerCase())) {
        return { type: 'error', message: 'Already watching that address.' };
      }

      const entry: WatchedAddress = {
        address: target.address,
        label: labelParts.join(' ') || target.label,
        addedAt: Date.now(),
      };

      await writeWatched(context, chain.id, [...list, entry]);
      return {
        type: 'notice',
        tone: 'success',
        message: `Watching ${entry.label} (${shortAddress(entry.address)}) on ${chain.name}`,
      };
    },
  },

  {
    name: 'unwatch',
    showIn: ['channel'],
    description: 'Stop watching an address',
    usage: '/unwatch <address> [--chain base]',
    async run({ args, context }) {
      const picked = await resolve(args);
      if ('error' in picked) return { type: 'error', message: picked.error };
      const { chain, rest } = picked;

      const [address] = rest;
      if (!address) return { type: 'error', message: 'Which address? /unwatch 0x…' };

      const list = await readWatched(context, chain.id);
      const next = list.filter((w) => w.address.toLowerCase() !== address.toLowerCase());

      if (next.length === list.length) {
        return { type: 'error', message: 'That address is not on your watch list.' };
      }

      await writeWatched(context, chain.id, next);
      return {
        type: 'notice',
        tone: 'success',
        message: `Stopped watching that address on ${chain.name}`,
      };
    },
  },

  {
    name: 'watched',
    showIn: ['channel'],
    description: 'List the addresses you are tracking',
    usage: '/watched [--chain base]',
    async run({ args, respond }) {
      const picked = await resolve(args);
      if ('error' in picked) return { type: 'error', message: picked.error };

      await respond(await views.watched([picked.networkId]));
      return { type: 'handled' };
    },
  },
  ];
}
