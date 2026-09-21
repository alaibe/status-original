import type { Address } from 'viem';

import { shortAddress } from '@/core/identity/keyring';
import type { WidgetContent } from '@/core/messaging/types';
import type { PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';
import { looksLikeEnsName, lookupName, resolveName } from '@/lib/evm/ens';

import { chainStrategies, type ChainStrategy } from './chains/strategy';
import { activeNetwork, defaultChain } from './networks';

/**
 * Who an address or ENS name in a message belongs to, and what it holds.
 * `offerSend` is off in rooms where /send cannot run.
 */
export async function addressCard(
  context: PluginContext,
  value: string,
  { offerSend = true } = {}
): Promise<Omit<WidgetContent, 'live'>> {
  const chains = chainStrategies();
  let address = value;
  let name: string | null = null;

  if (!chains.some((chain) => chain.isAddress(value)) && looksLikeEnsName(value)) {
    const resolved = await resolveName(value);
    if (!resolved) throw new Error(`No address is set for ${value}.`);
    address = resolved;
    name = value.toLowerCase();
  }

  const matches = chains.filter((chain) => chain.isAddress(address));
  if (matches.length === 0) throw new Error(`${address} belongs to a network that is off.`);
  const chain = defaultChain(matches, address, (await activeNetwork(context))?.id);

  if (!name && address.startsWith('0x')) {
    name = await lookupName(address as Address).catch(() => null);
  }

  const balance = await chain.balance?.(context, address).catch(() => null);
  return {
    kind: 'widget',
    fallback: `${name ?? shortAddress(address)} on ${chain.name}`,
    widget: W.card([
      W.list([
        {
          title: name ?? shortAddress(address),
          subtitle: [
            name ? shortAddress(address) : null,
            balance ? `${balance} ${chain.transfer?.symbol ?? ''}`.trim() : null,
            chain.name,
          ]
            .filter(Boolean)
            .join(' · '),
          icon: chain.icon,
          actions: offerSend ? sendAction(chain, name ?? address) : [],
        },
      ]),
      W.link(`View on ${chain.explorer.name}`, chain.explorer.addressUrl(address), 'open-outline'),
    ]),
  };
}

function sendAction(chain: ChainStrategy, recipient: string) {
  if (!chain.transfer) return [];
  return [
    {
      label: `Send ${chain.transfer.symbol}`,
      command: `/send ${recipient} --chain ${chain.id}`,
      icon: 'arrow-up-circle-outline' as const,
    },
  ];
}
