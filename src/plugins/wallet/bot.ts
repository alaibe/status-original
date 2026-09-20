import { poll, type Bot, type PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { enabledNetworks, NETWORKS } from './networks';

export const WALLET_BOT_ID = 'wallet';

const POLL_MS = 120_000;

export function makeWalletBot(context: PluginContext): Bot {
  return {
    id: WALLET_BOT_ID,
    name: 'Wallet',
    tagline: 'Balances, sends and networks',
    emoji: '👛',

    greeting: () => [
      'This is where your money lives. Every network you switch on reports here: a balance moving, a payment landing in the mempool and then confirming. Commands act on the network you have selected, and take --chain when you mean another one.',
      {
        kind: 'widget',
        fallback: '/balance /send /networks',
        widget: W.card(
          [
            W.list([
              {
                title: '/balance',
                subtitle: 'What you hold, across every network that is on',
                actions: [{ label: 'Show me', command: '/balance' }],
              },
              {
                title: '/send',
                subtitle: 'Move some, with a review step before anything is signed',
                actions: [{ label: 'Start one', command: '/send' }],
              },
              {
                title: '/gas',
                subtitle: 'What a transaction costs on a network right now',
                actions: [{ label: 'Check', command: '/gas' }],
              },
              {
                title: '/networks',
                subtitle: `Switch networks on and off (${NETWORKS.length} available)`,
                actions: [{ label: 'Networks', command: '/networks' }],
              },
              {
                title: '/watch',
                subtitle: 'Track an address and hear about it here',
                actions: [{ label: 'Watch one', command: '/draft /watch ' }],
              },
            ]),
            W.text(
              'Asking someone for money and splitting a bill live in the conversation with ' +
                'them: /request and /split only make sense where there is somebody to ask.'
            ),
          ],
          { title: 'Wallet', icon: 'wallet-outline' }
        ),
      },
    ],

    activate: poll(POLL_MS, async (ctx) => {
      for (const network of await enabledNetworks(context)) {
        if (!network.poll) continue;
        try {
          await network.poll(context, (content) => ctx.say(content));
        } catch (error) {
          console.warn(`[wallet] ${network.id} poll failed`, error);
        }
      }
    }),

    async onMessage(text, ctx) {
      const asked = /\b(balance|how much|hold|send|pay|gas|fee|explorer|rpc|node|watch)\b/i.test(text);
      await ctx.say(
        asked
          ? 'Try /balance, /send, /gas, /watch, /explorer or /rpc. Add --chain to mean a different network.'
          : 'This room is money: /balance to start, /networks to choose which chains, or / to see the rest.'
      );
    },
  };
}
