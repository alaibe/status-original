import type { WidgetContent } from '@/core/messaging/types';
import type {
  PluginContext,
  PluginSummary,
  PluginView,
  SlashCommand,
} from '@/core/plugins/types';
import { W } from '@/design/widgets';
import { lookupName } from '@/lib/evm/ens';

export function assistantCommands(views: { plugins: PluginView }): SlashCommand[] {
  return [
    {
      name: 'commands',
      description: 'Show commands available in this chat',
      usage: '/commands [plugin]',
      global: true,
      async run({ respond, context, args, conversationId }) {
        const commands = context.plugins.commands(conversationId);

        if (commands.length === 0) {
          await respond('No commands available. Enable a plugin with /plugins.');
          return { type: 'handled' };
        }

        let plugin: Pick<PluginSummary, 'id' | 'name' | 'icon'> | undefined;
        const wanted = args[0]?.toLowerCase();
        if (wanted) {
          const plugins = context.plugins.list();
          const owners = [...new Set(commands.map((c) => c.pluginId))].map((id) => {
            const summary = plugins.find((p) => p.id === id);
            return { id, name: summary?.name ?? id, icon: summary?.icon };
          });
          plugin =
            owners.find((p) => p.id.toLowerCase() === wanted) ??
            owners.find((p) => p.name.toLowerCase() === wanted) ??
            owners.find((p) => p.name.toLowerCase().startsWith(wanted));

          if (!plugin) {
            return {
              type: 'error',
              message: `No commands available here for "${args[0]}". Try ${owners.map((p) => `/commands ${p.id}`).join(', ')}.`,
            };
          }
        }

        const available = plugin ? commands.filter((c) => c.pluginId === plugin.id) : commands;
        await respond({
          kind: 'widget',
          fallback: `${plugin?.name ?? 'Commands'}: ${available.map((c) => `/${c.name}`).join(', ')}`,
          widget: W.card(
            [
              W.list(
                available.map((c) => ({
                  title: `/${c.name}`,
                  subtitle: c.usage === `/${c.name}` ? c.description : `${c.description} · ${c.usage}`,
                  actions: [{ label: `Run /${c.name}`, command: `/${c.name}` }],
                }))
              ),
            ],
            { title: plugin?.name ?? 'Commands', icon: plugin?.icon ?? 'sparkles-outline' }
          ),
        });
        return { type: 'handled' };
      },
    },

    {
      name: 'plugins',
      showIn: ['channel'],
      description: 'Show which plugins are on',
      usage: '/plugins',
      async run({ respond }) {
        await respond(await views.plugins());
        return { type: 'handled' };
      },
    },

    {
      name: 'whoami',
      aliases: ['me'],
      description: 'Show the address someone else would message you at',
      usage: '/whoami',
      showIn: ['channel'],
      async run({ respond, context }) {
        let address: string;
        try {
          address = context.identity.address;
        } catch {
          return { type: 'error', message: 'No account loaded yet.' };
        }

        // Reverse lookup: a name is only yours if the address points back at
        // it, and that record is what anybody else can check.
        const name = await lookupName(address as `0x${string}`).catch(() => null);

        await respond({
          kind: 'widget',
          fallback: name ? `${name} (${address})` : `Your address: ${address}`,
          widget: W.card(
            [
              ...(name ? [W.stat(name, { label: 'What others see', tone: 'success' })] : []),
              W.code(address, { label: name ? 'Your address' : 'Message me at' }),
              W.text(
                name
                  ? `${name} points back at this address, so anyone can verify it is yours. ` +
                      'People can reach you by the name or by the address.'
                  : 'People reach you at this address. An ENS name can stand in for it: point ' +
                      'the name at this address, then set it as the primary name *from this ' +
                      'account*. That reverse record is the part others can check.'
              ),
              W.actions([
                { label: 'Which plugins are on?', command: '/plugins', tone: 'neutral' as const },
              ]),
              // A link: `/open` belongs to the Browser's own room, so a button
              // running it from here would answer "that belongs to Browser". The
              // link opens the site with no plugin switched on.
              W.link(
                name ? `${name} on ENS` : 'Get a name at app.ens.domains',
                'https://app.ens.domains'
              ),
            ],
            { title: name ?? 'Your address', icon: 'finger-print-outline' }
          ),
        });
        return { type: 'handled' };
      },
    },

    {
      name: 'enable',
      showIn: ['channel'],
      description: 'Turn a plugin on',
      usage: '/enable <plugin id>',
      async run({ args, context }) {
        return togglePlugin(args[0], true, context);
      },
    },

    {
      name: 'disable',
      showIn: ['channel'],
      description: 'Turn a plugin off',
      usage: '/disable <plugin id>',
      async run({ args, context }) {
        return togglePlugin(args[0], false, context);
      },
    },
  ];
}

export function pluginsCard(context: PluginContext): Omit<WidgetContent, 'live'> {
  const list = context.plugins.list();

  return {
    kind: 'widget',
    fallback: `${list.filter((p) => p.enabled).length} of ${list.length} plugins enabled`,
    widget: W.card(
      [
        W.rows(
          list.map((p) => ({
            label: p.name,
            value: '',
            state: p.enabled ? ('on' as const) : ('off' as const),
            actions: [
              p.enabled
                ? {
                    label: `Turn ${p.name} off`,
                    command: `/disable ${p.id}`,
                    icon: 'power' as const,
                    tone: 'danger' as const,
                  }
                : {
                    label: `Turn ${p.name} on`,
                    command: `/enable ${p.id}`,
                    icon: 'power' as const,
                  },
            ],
          }))
        ),
        W.text(
          'Tap a plugin to switch it. Its commands appear or vanish immediately. ' +
            'Use /commands in a chat to see the commands available there.'
        ),
      ],
      { title: 'Plugins', icon: 'extension-puzzle-outline' }
    ),
  };
}

async function togglePlugin(
  id: string | undefined,
  enabled: boolean,
  context: PluginContext
): ReturnType<SlashCommand['run']> {
  const verb = enabled ? 'enable' : 'disable';

  if (!id) {
    return { type: 'error', message: `Which plugin? Try /${verb} ethereum, or /plugins to see them.` };
  }

  const match = context.plugins.list().find((p) => p.id === id.toLowerCase());
  if (!match) {
    return { type: 'error', message: `No plugin called "${id}". Try /plugins.` };
  }

  if (match.enabled === enabled) {
    return { type: 'notice', message: `${match.name} was already ${enabled ? 'on' : 'off'}` };
  }

  await context.plugins.setEnabled(match.id, enabled);
  return {
    type: 'notice',
    tone: 'success',
    message: enabled
      ? `${match.name} is on`
      : `${match.name} is off. Its chats come back when you turn it on again.`,
  };
}
