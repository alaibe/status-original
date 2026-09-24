import { botConversationId, toContent } from '@/core/messaging/bots';
import { buttonCommand } from '@/core/commands/button';
import { parseCommand } from '@/core/commands/parser';
import { sessionFor, useChatStore } from '@/core/messaging/chat-store';
import { conversationScope } from '@/core/messaging/conversation-scope';
import type { MessageContent } from '@/core/messaging/types';
import { CORE_ID, worksOn } from '@/core/plugins/registry';
import { PERMISSION_LABELS } from '@/core/plugins/types';

import { approveOrThrow, findChat, whenAccountReady, type CliHandler } from '../context';
import { CliError } from '../errors';
import { contentLines } from '../widget-text';

function quote(word: string): string {
  return /^[\w@./:+=-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

export const pluginHandlers = {
  async plugins(_, { host }) {
    await whenAccountReady();
    const data = host.registry.list().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      description: p.manifest.description,
      enabled: host.registry.isActive(p.manifest.id),
      permissions: p.manifest.permissions,
    }));
    return {
      data,
      text: data.map(
        (p) => `${p.enabled ? '*' : ' '} ${p.id.padEnd(10)} ${p.name} — ${p.description}`
      ),
    };
  },

  async 'plugins enable'({ args }, { host, io }) {
    await whenAccountReady();
    const plugin = host.registry.get(args.plugin!);
    if (!plugin)
      throw new CliError(`No plugin "${args.plugin}". Run status-original plugins.`, 'notFound');
    const permissions = plugin.manifest.permissions.map((p) => PERMISSION_LABELS[p]);
    await approveOrThrow(
      io,
      [
        `Turn on ${plugin.manifest.name}?`,
        ...(permissions.length ? ['It will be able to:', ...permissions.map((p) => `• ${p}`)] : []),
      ].join('\n')
    );
    await host.setEnabled(plugin.manifest.id, true);
    return {
      data: { id: plugin.manifest.id, enabled: true },
      text: `${plugin.manifest.name} is on.`,
    };
  },

  async 'plugins disable'({ args }, { host }) {
    await whenAccountReady();
    const plugin = host.registry.get(args.plugin!);
    if (!plugin)
      throw new CliError(`No plugin "${args.plugin}". Run status-original plugins.`, 'notFound');
    await host.setEnabled(plugin.manifest.id, false);
    return {
      data: { id: plugin.manifest.id, enabled: false },
      text: `${plugin.manifest.name} is off.`,
    };
  },

  async commands({ args }, { host }) {
    await whenAccountReady();
    const { registry } = host;
    const entries = args.chat
      ? await (async () => {
          const chat = await findChat(args.chat!);
          const session = sessionFor(useChatStore.getState(), chat.id);
          return registry
            .commandListFor(chat.id, conversationScope(chat.id, chat.kind))
            .filter(({ command }) => worksOn(command, session));
        })()
      : [
          ...new Map([...registry.commands().values()].map((e) => [e.command.name, e])).values(),
        ].filter((e) => !e.command.hidden);
    const data = entries.map(({ command, pluginId }) => ({
      name: command.name,
      plugin: pluginId,
      description: command.description,
      usage: command.usage,
      needsChat: pluginId === CORE_ID || !registry.botsOf(pluginId).length,
    }));
    return {
      data,
      text: data.map((c) => `/${c.name.padEnd(12)} ${c.description}  (${c.plugin})  ${c.usage}`),
    };
  },

  async link({ args }, { host }) {
    await whenAccountReady();
    if (!(await host.handleUri(args.uri!))) {
      throw new CliError('No plugin handles that link.', 'unsupported');
    }
    return { data: { handled: true }, text: 'Opened. Anything it asks for appears in the app.' };
  },

  async run({ args, rest }, { host, io }) {
    await whenAccountReady();
    const { registry } = host;
    const words = args.chat?.startsWith('/') ? [args.chat, ...rest] : rest;
    const chatRef = args.chat?.startsWith('/') ? undefined : args.chat;
    const text = words.join(' ');
    const parsed = parseCommand(text);
    if (!parsed) throw new CliError('Give a slash command, e.g. /balance.', 'usage');

    let chatId: string;
    let entry;
    if (chatRef) {
      const chat = await findChat(chatRef);
      chatId = chat.id;
      entry = registry.commandsFor(chat.id, conversationScope(chat.id, chat.kind)).get(parsed.name);
      if (entry && !worksOn(entry.command, sessionFor(useChatStore.getState(), chat.id))) {
        throw new CliError(`/${parsed.name} does not work on this network.`, 'unsupported');
      }
    } else {
      entry = registry.commands().get(parsed.name);
      const bot = entry ? registry.botsOf(entry.pluginId)[0] : undefined;
      if (entry && !bot)
        throw new CliError(
          `/${parsed.name} needs a chat: status-original run <chat> ${text}`,
          'usage'
        );
      chatId = bot ? botConversationId(bot.id) : '';
    }
    if (!entry) {
      throw new CliError(
        `Unknown command /${parsed.name}. Run status-original commands.`,
        'notFound'
      );
    }

    const title =
      useChatStore.getState().conversations.find((c) => c.id === chatId)?.title ?? chatId;
    if (parsed.args.includes('--confirm')) await approveOrThrow(io, `Run ${text}\nin ${title}`);

    const replies: MessageContent[] = [];
    const result = await entry.command.run({
      rest: parsed.rest,
      args: parsed.args,
      conversationId: chatId,
      context: entry.context,
      respond: async (content) => {
        replies.push(toContent(content));
      },
    });

    const target = chatRef ? `${quote(chatRef)} ` : '';
    const again = (command: string) => {
      const button = buttonCommand(command);
      if (button.kind === 'reply') {
        return `status-original send ${target || `${chatId} `}${quote(button.text)}`;
      }
      const hint = button.kind === 'draft' ? '  (fill in the rest)' : '';
      return `status-original run ${target}${button.text.trim()}${hint}`;
    };
    const lines = replies.flatMap((content) => contentLines(content, again));
    if (result.type === 'error') throw new CliError([...lines, result.message].join('\n'));
    if (result.type === 'notice') lines.push(result.message);
    if (result.type === 'setComposer') lines.push(`Next: ${again(result.text)}`);
    return {
      data: { chat: chatId, result, replies },
      text: lines.length ? lines : 'Done.',
    };
  },
} satisfies Record<string, CliHandler>;
