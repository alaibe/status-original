import type { Chain } from 'viem';

import { flagValue, withoutFlag } from '@/core/commands/flags';
import { errorMessage } from '@/core/errors';
import type { PluginContext, PluginView, SlashCommand } from '@/core/plugins/types';
import type { IconName } from '@/design';
import { W } from '@/design/widgets';

import { checkAddress as bitcoinPoll } from './bitcoin/bot';
import { bitcoinStrategy } from './bitcoin';
import { hydrateApiBase } from './bitcoin/config';
import { EVM_CHAINS, evmStrategy } from './chains/evm';
import { hydrateRpcOverrides } from './chains/rpc';
import {
  registerChainStrategy,
  sendableChains,
  type ChainStrategy,
  type Say,
} from './chains/strategy';
import { checkBalances } from './chains/watcher';
import { solanaStrategy } from './solana';
import { hydrateRpcUrl as hydrateSolanaRpc } from './solana/rpc';

export interface Network {
  id: string;
  name: string;
  icon: IconName;
  description: string;
  evm?: Chain;
  /** A test network: its coin comes from a faucet and is worth nothing. */
  testnet?: boolean;
  strategy(context: PluginContext): ChainStrategy;
  poll?(context: PluginContext, say: Say): Promise<void>;
  hydrate?(context: PluginContext): Promise<void>;
}

export const NETWORKS: Network[] = [
  ...EVM_CHAINS.map(
    (spec): Network => ({
      id: spec.id,
      name: spec.name,
      icon: spec.icon,
      description: spec.description,
      evm: spec.chain,
      testnet: spec.testnet,
      strategy: () => evmStrategy(spec),
      poll: (context, say) => checkBalances(spec.chain, context, say),
    })
  ),
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    icon: 'logo-bitcoin',
    description: 'A native SegWit address from your recovery phrase.',
    strategy: bitcoinStrategy,
    poll: bitcoinPoll,
    hydrate: hydrateApiBase,
  },
  {
    id: 'solana',
    name: 'Solana',
    icon: 'sunny-outline',
    description: 'An ed25519 address from the same recovery phrase.',
    strategy: () => solanaStrategy,
    hydrate: hydrateSolanaRpc,
  },
];

export function networkById(id: string | undefined): Network | undefined {
  if (!id) return undefined;
  const wanted = id.toLowerCase();
  return NETWORKS.find((n) => n.id === wanted || n.name.toLowerCase() === wanted);
}

const STORAGE_ENABLED = 'networks';
const STORAGE_ACTIVE = 'active-network';

const DEFAULT_ENABLED = ['ethereum'];

export async function enabledIds(context: PluginContext): Promise<string[]> {
  return (await context.storage.get<string[]>(STORAGE_ENABLED)) ?? DEFAULT_ENABLED;
}

const networksOf = (ids: string[]) => NETWORKS.filter((n) => ids.includes(n.id));

export async function enabledNetworks(context: PluginContext): Promise<Network[]> {
  return networksOf(await enabledIds(context));
}

/** Pass `enabled` when the caller has already read the enabled ids. */
export async function activeNetwork(
  context: PluginContext,
  enabled?: string[]
): Promise<Network | null> {
  const [ids, saved] = await Promise.all([
    enabled ?? enabledIds(context),
    context.storage.get<string>(STORAGE_ACTIVE),
  ]);
  const on = networksOf(ids);
  if (on.length === 0) return null;
  return on.find((n) => n.id === saved) ?? on[0];
}

const registered = new Map<string, () => void>();

export async function syncStrategies(context: PluginContext, enabled?: string[]): Promise<void> {
  const wanted = networksOf(enabled ?? (await enabledIds(context)));
  const wantedIds = new Set(wanted.map((n) => n.id));

  for (const [id, dispose] of registered) {
    if (!wantedIds.has(id)) {
      dispose();
      registered.delete(id);
    }
  }

  for (const network of wanted) {
    if (registered.has(network.id)) continue;
    await network.hydrate?.(context);
    registered.set(network.id, registerChainStrategy(network.strategy(context)));
  }
}

export function disposeStrategies(): void {
  for (const dispose of registered.values()) dispose();
  registered.clear();
}

export async function setEnabled(
  context: PluginContext,
  id: string,
  on: boolean,
  enabled?: string[]
): Promise<void> {
  const current = enabled ?? (await enabledIds(context));
  const ids = new Set(current);
  const active = await activeNetwork(context, current);
  if (!on && active?.id === id) {
    throw new Error(
      `${active.name} is the default. Choose another enabled network with /networks <id> default before turning it off.`
    );
  }
  if (on) {
    await context.storage.set(STORAGE_ACTIVE, active?.id ?? id);
    ids.add(id);
  } else {
    ids.delete(id);
  }
  await context.storage.set(STORAGE_ENABLED, [...ids]);
  if (on) await hydrateRpcOverrides(context);
  await syncStrategies(context, [...ids]);
}

export async function setActive(
  context: PluginContext,
  id: string,
  enabled?: string[]
): Promise<void> {
  const on = networksOf(enabled ?? (await enabledIds(context)));
  if (!on.some((network) => network.id === id)) {
    throw new Error(`Turn the network on with /networks ${id} on before making it the default.`);
  }
  await context.storage.set(STORAGE_ACTIVE, id);
}

const CHAIN_ALIASES = ['-c'];

export const chainFlag = (args: string[]) => flagValue(args, '--chain', CHAIN_ALIASES);
export const withoutChain = (args: string[]) => withoutFlag(args, '--chain', CHAIN_ALIASES);

export const NO_NETWORK_ON = 'No network is switched on. /networks turns one on.';
const notSwitchedOn = (named: string) => `${named} is not switched on. See /networks.`;

export function defaultChain<T extends ChainStrategy>(
  chains: T[],
  recipient?: string,
  configuredDefault?: string
): T {
  const matches = recipient ? chains.filter((c) => c.isAddress(recipient)) : [];
  const from = matches.length > 0 ? matches : chains;
  return (
    from.find((c) => c.id === configuredDefault) ?? from.find((c) => c.id === 'ethereum') ?? from[0]
  );
}

/** The strategy `--chain` names, from those switched on. */
export function pickStrategy<T extends ChainStrategy>(
  chains: T[],
  named: string
): { chain: T } | { error: string } {
  const chain = chains.find((c) => c.id === named);
  return chain ? { chain } : { error: notSwitchedOn(named) };
}

export type PickedSendable = {
  chain: ChainStrategy;
  /** Every network that can send, for the forms to offer. */
  chains: ChainStrategy[];
  token?: string;
  rest: string[];
};

/**
 * A network to send on: the one `--chain` names, else the default for the
 * recipient `recipientOf` finds among the positional args. Preferences are
 * only read when nothing was named.
 */
export async function pickSendable(
  context: PluginContext,
  args: string[],
  recipientOf: (rest: string[]) => string | undefined = () => undefined
): Promise<PickedSendable | { error: string }> {
  const chains = sendableChains();
  if (chains.length === 0) return { error: NO_NETWORK_ON };

  const named = chainFlag(args);
  const token = flagValue(args, '--token');
  const rest = withoutFlag(withoutChain(args), '--token');

  if (named) {
    const picked = pickStrategy(chains, named);
    return 'error' in picked ? picked : { ...picked, chains, token, rest };
  }

  const active = await activeNetwork(context);
  return { chain: defaultChain(chains, recipientOf(rest), active?.id), chains, token, rest };
}

export type Picked = { network: Network; rest: string[] };

export async function pickNetwork(
  context: PluginContext,
  args: string[]
): Promise<Picked | { error: string }> {
  const rest = withoutChain(args);
  const named = chainFlag(args);

  if (named) {
    const network = networkById(named);
    if (!network) return { error: `No network called "${named}". /networks lists them.` };
    const enabled = await enabledIds(context);
    if (!enabled.includes(network.id)) {
      return { error: `${network.name} is switched off. Turn it on with /networks ${network.id}.` };
    }
    return { network, rest };
  }

  const active = await activeNetwork(context);
  if (!active) return { error: NO_NETWORK_ON };
  return { network: active, rest };
}

export async function pickEvm(
  context: PluginContext,
  args: string[]
): Promise<{ chain: Chain; networkId: string; rest: string[] } | { error: string }> {
  const picked = await pickNetwork(context, args);
  if ('error' in picked) return picked;
  if (!picked.network.evm) {
    return {
      error: `That only works on an EVM network, and ${picked.network.name} is not one.`,
    };
  }
  return { chain: picked.network.evm, networkId: picked.network.id, rest: picked.rest };
}

export async function networksCard(context: PluginContext) {
  const enabled = await enabledIds(context);
  const active = await activeNetwork(context, enabled);

  return {
    kind: 'widget' as const,
    fallback: `${enabled.length} of ${NETWORKS.length} networks on`,
    widget: W.card(
      [
        W.list(
          NETWORKS.map((network) => {
            const on = enabled.includes(network.id);
            const isActive = active?.id === network.id;
            return {
              title: network.name,
              subtitle: network.description,
              icon: network.icon,
              state: on ? ('on' as const) : ('off' as const),
              status: network.testnet
                ? isActive
                  ? 'Test · Default'
                  : 'Test'
                : isActive
                  ? 'Default'
                  : undefined,
              tone: on ? ('brand' as const) : undefined,
              actions: !on
                ? [
                    {
                      label: 'Turn on',
                      command: `/networks ${network.id} on`,
                      icon: 'power' as const,
                    },
                  ]
                : isActive
                  ? []
                  : [
                      {
                        label: 'Make default',
                        command: `/networks ${network.id} default`,
                        icon: 'star-outline' as const,
                      },
                      {
                        label: 'Turn off',
                        command: `/networks ${network.id} off`,
                        icon: 'power' as const,
                        tone: 'danger' as const,
                      },
                    ],
            };
          })
        ),
        W.text(
          'Test networks are marked. Their coins come from a faucet and are worth ' +
            'nothing, which makes them the safe place to try a first send. ' +
            'A network that is on can be sent from, watched and asked for a balance. ' +
            'The default is what a command means when it does not say --chain. ' +
            '/networks <id> or /networks <id> on turns one on without changing the default. ' +
            '/networks <id> default chooses an enabled network as the default. ' +
            '/networks <id> off stops its polling; it deletes nothing. ' +
            'Choose another default before turning off the current one.'
        ),
      ],
      { title: 'Networks', icon: 'git-network-outline' }
    ),
  };
}

export function networksCommand(
  context: PluginContext,
  views: { networks: PluginView }
): SlashCommand {
  return {
    name: 'networks',
    aliases: ['chains', 'network'],
    showIn: ['channel'],
    description: 'Switch networks on and off, and choose the default',
    usage: '/networks [ethereum | base | bitcoin | …] [on | off | default]',
    async run({ args, respond }) {
      const [name, verb] = args;
      if (args.length > 2 || (verb && !['on', 'off', 'default'].includes(verb))) {
        return {
          type: 'error',
          message:
            'Use /networks <id> on to enable, default to choose an enabled network, or off to disable a nondefault network.',
        };
      }

      if (name) {
        const network = networkById(name);
        if (!network) {
          return { type: 'error', message: `No network called "${name}". /networks lists them.` };
        }

        const enabled = await enabledIds(context);
        const isOn = enabled.includes(network.id);

        try {
          if (verb === 'off') {
            if (!isOn) return { type: 'error', message: `${network.name} is already off.` };
            await setEnabled(context, network.id, false, enabled);
            return { type: 'notice', tone: 'success', message: `${network.name} is off` };
          }
          if (verb === 'default') {
            await setActive(context, network.id, enabled);
            return {
              type: 'notice',
              tone: 'success',
              message: `${network.name} is the default now`,
            };
          }
          if (isOn) return { type: 'notice', message: `${network.name} is already on` };
          await setEnabled(context, network.id, true, enabled);
          return { type: 'notice', tone: 'success', message: `${network.name} is on` };
        } catch (error) {
          return {
            type: 'error',
            message: errorMessage(error, 'Could not update network preferences.'),
          };
        }
      }

      await respond(await views.networks());
      return { type: 'handled' };
    },
  };
}
