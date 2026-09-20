import type { Bot, PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { readBots } from './types';

export const BOTS_BOT_ID = 'bots';

export function makeBotsBot(context: PluginContext): Bot {
  return {
    id: BOTS_BOT_ID,
    name: 'Bots',
    tagline: 'Add and manage bots',
    emoji: '🤖',

    greeting: () => [
      'A bot is an address that answers. Anyone can run one: you add it by address, and it appears in your chat list like any other conversation.',
      {
        kind: 'widget',
        fallback: '/addbot, /bots, /startbot, /removebot',
        widget: W.card(
          [
            W.list([
              {
                title: '/addbot',
                subtitle: 'Add a bot by address or ENS name',
                actions: [{ label: 'Add a bot', command: '/addbot' }],
              },
              {
                title: '/bots',
                subtitle: 'The bots you have added',
                actions: [{ label: 'Show them', command: '/bots' }],
              },
              { title: '/startbot', subtitle: 'Send a bot its /start, so it introduces itself' },
              { title: '/removebot', subtitle: 'Forget a bot. Its conversation stays.' },
            ]),
            W.text(
              'A bot can reply with buttons, and each button carries a command. So a bot can ' +
                'ask you to send something, and you confirm it yourself, with the same review ' +
                'you would get typing it.'
            ),
          ],
          { title: 'Bots', icon: 'hardware-chip-outline' }
        ),
      },
    ],

    async onMessage(_text, ctx) {
      const bots = await readBots(context);
      await ctx.say(
        bots.length === 0
          ? 'No bots yet. /addbot <address> adds one, and it shows up in your chat list like any other conversation.'
          : `You have ${bots.length} bot${bots.length === 1 ? '' : 's'}. /bots lists them, and each one has its own conversation. Talk to it there.`
      );
    },
  };
}
