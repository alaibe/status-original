import { isLocalConversation } from '@/core/messaging/bots';
import { useChatStore, xmtpSessionFor } from '@/core/messaging/chat-store';
import { liveViews } from '@/core/plugins/live';
import type { Plugin, PluginContext, SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { makeBotsBot } from './bot';
import { BotWidgetMessage } from './renderer';
import { resolveBot } from './resolve';
import { CONTENT_TYPE_UI, readBots, writeBots, type KnownBot, type UiMessage } from './types';

async function botsCard(context: PluginContext) {
  const bots = await readBots(context);

  if (bots.length === 0) {
    return {
      kind: 'widget' as const,
      fallback: 'No bots yet',
      widget: W.card(
        [
          W.text(
            'A bot is just an address that answers. Add one and it appears in your ' +
              'chat list like any other conversation.'
          ),
          W.actions([{ label: 'Add a bot', command: '/addbot' }]),
          W.text(
            'Anyone can run a bot, and nobody vets them. A bot sees everything you send ' +
              'it, exactly like a person would.'
          ),
        ],
        { title: 'No bots yet', icon: 'hardware-chip-outline' }
      ),
    };
  }

  return {
    kind: 'widget' as const,
    fallback: `${bots.length} bot${bots.length === 1 ? '' : 's'}`,
    widget: W.card(
      [
        W.rows(
          bots.map((bot) => ({
            label: bot.name,
            value: bot.description ?? bot.address.slice(0, 12),
            actions: [
              {
                label: `Say hello to ${bot.name}`,
                command: `/startbot ${bot.address}`,
                icon: 'chatbubble-outline' as const,
              },
            ],
          }))
        ),
        W.actions([{ label: 'Add another', command: '/addbot' }]),
      ],
      { title: 'Your bots', icon: 'hardware-chip-outline' }
    ),
  };
}

export const botsPlugin: Plugin = {
  manifest: {
    id: 'bots',
    name: 'Bots',
    description: 'Add bots by address and talk to them. Bots can reply with cards and buttons.',
    version: '1.0.0',
    icon: 'hardware-chip-outline',
    permissions: ['identity.read', 'chat.read', 'chat.send', 'network', 'storage'],
    requiresSessionRestart: true,
  },

  setup(context) {
    const views = liveViews(context, { bots: () => botsCard(context) });
    const commands: SlashCommand[] = [
      {
        name: 'bots',
        showIn: ['channel'],
        description: 'Bots you have added',
        usage: '/bots',
        async run({ respond }) {
          await respond(await views.bots());
          return { type: 'handled' };
        },
      },

      {
        name: 'addbot',
        showIn: ['channel'],
        description: 'Add a bot by address, ENS name or name@domain',
        usage: '/addbot <address | name.eth | name@domain> [name]',
        async run({ args }) {
          if (args.length === 0) return { type: 'setComposer', text: '/addbot ' };
          const [input, ...nameParts] = args;
          if (!input) {
            return { type: 'error', message: 'Which bot? /addbot pricebot.eth Prices' };
          }

          const session = xmtpSessionFor(useChatStore.getState());
          if (!session) return { type: 'error', message: 'Not connected to the network yet.' };

          const resolved = await resolveBot(input);
          if (!resolved) return { type: 'error', message: `Could not find ${input}.` };
          const { address } = resolved;

          const inboxId = await session.resolvePeer(address);
          if (!inboxId) {
            return {
              type: 'error',
              message:
                `${input} has no XMTP inbox, so nothing is listening there. ` +
                'A bot has to have opened an XMTP client at least once.',
            };
          }

          const bots = await readBots(context);
          if (bots.some((b) => b.address.toLowerCase() === address.toLowerCase())) {
            return { type: 'error', message: 'That bot is already on your list.' };
          }

          const bot: KnownBot = {
            address,
            name: nameParts.join(' ') || resolved.name || input.split(/[.@]/)[0],
            description: resolved.description,
            inboxId,
            addedAt: Date.now(),
          };
          await writeBots(context, [...bots, bot]);
          return {
            type: 'notice',
            tone: 'success',
            message: `${bot.name} added. Nobody vetted it: it sees everything you send it.`,
          };
        },
      },

      {
        name: 'removebot',
        showIn: ['channel'],
        description: 'Forget a bot',
        usage: '/removebot <address | name.eth | name@domain>',
        async run({ args }) {
          const [input] = args;
          if (!input) return { type: 'error', message: 'Which one? /removebot pricebot.eth' };

          const resolved = await resolveBot(input);
          const names = [input, resolved?.address].flatMap((n) => (n ? [n.toLowerCase()] : []));
          const bots = await readBots(context);
          const next = bots.filter((b) => !names.includes(b.address.toLowerCase()));
          if (next.length === bots.length) {
            return { type: 'error', message: 'That bot is not on your list.' };
          }

          await writeBots(context, next);
          return {
            type: 'notice',
            tone: 'success',
            message: 'Removed. The conversation stays; only the shortcut is gone.',
          };
        },
      },

      {
        name: 'startbot',
        showIn: ['channel'],
        aliases: ['start'],
        description: 'Send /start to a bot, the usual way to begin',
        usage: '/startbot <address | name.eth | name@domain>',
        async run({ args, conversationId }) {
          const [input] = args;

          if (!input && !isLocalConversation(conversationId)) {
            await context.chat.sendText(conversationId, '/start');
            return { type: 'handled' };
          }
          if (!input) return { type: 'error', message: 'Which bot? /startbot pricebot.eth' };

          const resolved = await resolveBot(input);
          const target = resolved && (await context.chat.startDm(resolved.address));
          if (!target) {
            return { type: 'error', message: `${input} has no XMTP inbox.` };
          }

          await context.chat.sendText(target, '/start');
          return {
            type: 'notice',
            tone: 'success',
            message: `Sent /start to ${input}. Its reply lands in that chat.`,
          };
        },
      },
    ];

    return {
      commands,
      views,

      bots: [makeBotsBot(context)],

      async names() {
        const bots = await readBots(context);
        return Object.fromEntries(bots.flatMap((b) => (b.inboxId ? [[b.inboxId, b.name]] : [])));
      },

      composerActions: [
        {
          id: 'addbot',
          label: 'Add bot',
          icon: 'add-circle-outline',
          command: '/addbot',
          showIn: ['channel'],
        },
      ],

      contentTypes: [
        {
          typeId: CONTENT_TYPE_UI,
          fallback: (data: UiMessage) => data?.fallback ?? 'Interactive message',
          render: BotWidgetMessage,
        },
      ],
    };
  },
};
