import { liveViews } from '@/core/plugins/live';
import type { Plugin } from '@/core/plugins/types';

import { makeMarketsBot } from './bot';
import { alertsCard, marketApiCard, marketsCommands } from './commands';
import { hydrateApiBase } from './storage';

export const marketsPlugin: Plugin = {
  manifest: {
    id: 'markets',
    name: 'Markets',
    description:
      'Spot prices and a chat that tells you when one crosses a level or moves by a percentage.',
    version: '1.0.0',
    icon: 'trending-up-outline',
    permissions: ['network', 'storage'],
  },

  setup(context) {
    const views = liveViews(context, {
      alerts: () => alertsCard(context),
      marketapi: () => marketApiCard(),
    });
    return {
      bots: [makeMarketsBot(context)],
      commands: marketsCommands(context, views),
      views,

      composerActions: [
        {
          id: 'price',
          label: 'Price',
          icon: 'trending-up-outline',
          command: '/price',
          showIn: ['channel'],
        },
        {
          id: 'alert',
          label: 'Alert',
          icon: 'notifications-outline',
          command: '/alert',
          showIn: ['channel'],
        },
      ],

      async start() {
        await hydrateApiBase(context);
      },
    };
  },
};
