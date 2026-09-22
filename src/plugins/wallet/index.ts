import { liveViews } from '@/core/plugins/live';
import type { Plugin, PluginContext } from '@/core/plugins/types';

import { addressCard } from './address-card';
import { makeWalletBot } from './bot';
import { walletCommands } from './commands';
import { walletContentTypes } from './content-types';
import {
  disposeStrategies,
  enabledNetworks,
  networkById,
  networksCard,
  networksCommand,
  pickEvm,
  syncStrategies,
} from './networks';
import { chainRoomCommands, endpointCard } from './room-commands';
import { tradeCommand } from './trade';
import { watchCommands, watchedCard } from './chains/watch-commands';
import { hydrateRpcOverrides } from './chains/rpc';

export const walletPlugin: Plugin = {
  manifest: {
    id: 'wallet',
    name: 'Wallet',
    description:
      'Balances, sends, trades and payment requests, on the networks you switch on.',
    version: '2.0.0',
    icon: 'wallet-outline',
    permissions: [
      'identity.read',
      'identity.sign',
      'chat.read',
      'chat.send',
      'browser.open',
      'network',
      'storage',
    ],
    requiresSessionRestart: true,
  },

  setup(context: PluginContext) {
    const views = liveViews(context, {
      address: ([value, mode]) => addressCard(context, value, { offerSend: mode !== 'no-send' }),
      networks: () => networksCard(context),
      endpoint: ([id]) => {
        const network = networkById(id);
        if (!network) throw new Error(`No network called "${id}".`);
        return endpointCard(context, network);
      },
      watched: ([id]) => {
        const chain = networkById(id)?.evm;
        if (!chain) throw new Error(`No EVM network called "${id}".`);
        return watchedCard(context, chain, id);
      },
    });

    return {
      bots: [makeWalletBot(context)],
      contentTypes: walletContentTypes,
      views,

      commands: [
        ...walletCommands,
        tradeCommand,
        ...chainRoomCommands(context, views),
        ...watchCommands((args) => pickEvm(context, args), views),
        networksCommand(context, views),
      ],

      composerActions: [
        {
          id: 'request',
          label: 'Request',
          icon: 'arrow-down-circle-outline',
          command: '/request',
          showIn: ['dm', 'group'],
        },
        {
          id: 'send',
          label: 'Send',
          icon: 'arrow-up-circle-outline',
          command: '/send',
          showIn: ['dm', 'group'],
        },
        {
          id: 'balance',
          label: 'Balance',
          icon: 'wallet-outline',
          command: '/balance',
          showIn: ['channel'],
        },
        {
          id: 'room-send',
          label: 'Send',
          icon: 'arrow-up-circle-outline',
          command: '/send',
          showIn: ['channel'],
        },
        {
          id: 'trade',
          label: 'Trade',
          icon: 'swap-horizontal-outline',
          command: '/trade',
          showIn: ['channel'],
        },
        {
          id: 'networks',
          label: 'Networks',
          icon: 'git-network-outline',
          command: '/networks',
          showIn: ['channel'],
        },
      ],

      async start() {
        await hydrateRpcOverrides(context);
        await syncStrategies(context);
        return disposeStrategies;
      },
    };
  },
};

export { enabledNetworks };
