import type { PluginContext, PluginView, SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { targetAddress } from './chains/strategy';
import { pickNetwork, type Network } from './networks';
import { walletErrorMessage } from './errors';

export async function endpointCard(context: PluginContext, network: Network) {
  const strategy = network.strategy(context);
  const current = await strategy.endpoint.current(context);
  return {
    kind: 'widget' as const,
    fallback: `${strategy.name} ${strategy.endpoint.noun}: ${current}`,
    widget: W.card(
      [
        W.form([{ id: 'url', label: 'URL', placeholder: 'https://…' }], {
          label: `Use this ${strategy.endpoint.noun}`,
          command: `/rpc {url} --chain ${network.id}`,
        }),
        W.code(current, {
          label: strategy.endpoint.isDefault(current) ? 'Now using (default)' : 'Now using',
        }),
        W.text(
          `Reads go straight from this device to whoever runs that ${strategy.endpoint.noun}, ` +
            `so they see the addresses you look at. /rpc reset --chain ${network.id} ` +
            'goes back to the default.'
        ),
      ],
      { title: `${strategy.name} ${strategy.endpoint.noun}`, icon: 'server-outline' }
    ),
  };
}

export function chainRoomCommands(
  context: PluginContext,
  views: { endpoint: PluginView }
): SlashCommand[] {
  const here: SlashCommand['showIn'] = ['channel'];

  return [
    {
      name: 'explorer',
      aliases: ['btcexplorer', 'mempool', 'etherscan'],
      description: 'Open an address on a block explorer',
      usage: '/explorer [address] [--chain bitcoin]',
      showIn: here,
      async run({ args, context: ctx }) {
        const picked = await pickNetwork(context, args);
        if ('error' in picked) return { type: 'error', message: picked.error };

        const strategy = picked.network.strategy(context);
        const blocked = strategy.unavailable?.(ctx) ?? null;
        if (blocked) return blocked;

        const target = await targetAddress(strategy, ctx, picked.rest[0], { resolve: false });
        if ('error' in target) return { type: 'error', message: target.error };

        await ctx.ui.openExternalUrl(strategy.explorer.addressUrl(target.address));
        return { type: 'handled' };
      },
    },

    {
      name: 'gas',
      aliases: ['fees', 'op'],
      description: 'What a transaction costs right now',
      usage: '/gas [--chain bitcoin]',
      showIn: here,
      async run({ args, context: ctx, respond }) {
        const picked = await pickNetwork(context, args);
        if ('error' in picked) return { type: 'error', message: picked.error };

        const strategy = picked.network.strategy(context);
        if (!strategy.fees) {
          return {
            type: 'error',
            message: `${strategy.name} cannot say what a transaction costs here.`,
          };
        }

        try {
          const fees = await strategy.fees(ctx);
          await respond({
            kind: 'widget',
            fallback: `${strategy.name}: ${fees.headline}`,
            widget: W.card(
              [
                W.stat(fees.headline, { label: fees.label, caption: fees.caption }),
                W.rows(fees.rows),
                ...(fees.note ? [W.text(fees.note)] : []),
                ...(fees.link ? [W.link(fees.link.label, fees.link.url)] : []),
              ],
              { title: `${strategy.name} fees`, icon: 'speedometer-outline' }
            ),
          });
          return { type: 'handled' };
        } catch (error) {
          return {
            type: 'error',
            message: walletErrorMessage(error, strategy, 'fees'),
          };
        }
      },
    },

    {
      name: 'rpc',
      aliases: ['btcapi', 'endpoint'],
      description: 'Use your own endpoint for a network',
      usage: '/rpc <url | reset> [--chain solana]',
      showIn: here,
      async run({ args, context: ctx, respond }) {
        const picked = await pickNetwork(context, args);
        if ('error' in picked) return { type: 'error', message: picked.error };

        const strategy = picked.network.strategy(context);
        const blocked = strategy.unavailable?.(ctx) ?? null;
        if (blocked) return blocked;

        const [value] = picked.rest;

        if (!value) {
          await respond(await views.endpoint([picked.network.id]));
          return { type: 'handled' };
        }

        if (value === 'reset') {
          await strategy.endpoint.set(ctx, null);
          return {
            type: 'notice',
            tone: 'success',
            message: `Back on the default ${strategy.endpoint.noun} for ${strategy.name}`,
          };
        }

        if (!/^https?:\/\//i.test(value)) {
          return { type: 'error', message: 'The URL must start with http:// or https://.' };
        }

        const check = await strategy.endpoint.check(value);
        if (!check.ok) return { type: 'error', message: check.reason };

        await strategy.endpoint.set(ctx, value.replace(/\/$/, ''));
        return {
          type: 'notice',
          tone: 'success',
          message: `${strategy.name} reads go to ${value} now`,
        };
      },
    },
  ];
}
