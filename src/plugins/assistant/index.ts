import type { Plugin } from '@/core/plugins/types';

import { liveViews } from '@/core/plugins/live';

import { assistantCommands, pluginsCard } from './commands';
import { makeStatusBot } from './bot';

export const assistantPlugin: Plugin = {
  manifest: {
    id: 'assistant',
    name: 'Status Assistant',
    description:
      'Your on-device space for notes, commands and discovering features.',
    version: '1.0.0',
    icon: 'sparkles-outline',
    permissions: ['identity.read', 'plugins.manage', 'storage'],
  },

  setup(context) {
    const views = liveViews(context, { plugins: () => pluginsCard(context) });
    return {
      bots: [makeStatusBot()],
      commands: assistantCommands(views),
      views,

      composerActions: [
        {
          id: 'commands',
          label: 'Commands',
          icon: 'sparkles-outline',
          command: '/commands',
          showIn: ['dm', 'group', 'channel'],
          global: true,
        },
        {
          id: 'plugins',
          label: 'Plugins',
          icon: 'extension-puzzle-outline',
          command: '/plugins',
          showIn: ['channel'],
        },
      ],
    };
  },
};
