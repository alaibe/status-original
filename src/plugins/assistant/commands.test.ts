import { liveViews } from '@/core/plugins/live';
import type { PluginContext, PluginSummary, SlashCommand } from '@/core/plugins/types';

import { assistantCommands, pluginsCard } from './commands';

const AVAILABLE_COMMANDS = [
  {
    name: 'commands',
    description: 'Show commands available in this chat',
    usage: '/commands [plugin]',
    pluginId: 'assistant',
  },
  {
    name: 'balance',
    description: 'Check a balance',
    usage: '/balance [address]',
    pluginId: 'ethereum',
  },
];

function makeContext(
  plugins: PluginSummary[],
  onToggle = jest.fn(),
  channelOwner: string | undefined = undefined,
  commands = AVAILABLE_COMMANDS
): PluginContext {
  return {
    manifest: { id: 'assistant' },
    plugins: {
      list: () => plugins,
      setEnabled: async (id: string, enabled: boolean) => {
        await onToggle(id, enabled);
        plugins = plugins.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin));
      },
      channelOwner: () => channelOwner,
      commands: () => commands,
    },
  } as unknown as PluginContext;
}

const find = (name: string, context: PluginContext): SlashCommand =>
  assistantCommands(liveViews(context, { plugins: () => pluginsCard(context) })).find(
    (c) => c.name === name
  )!;

const run = async (name: string, args: string[], context: PluginContext) => {
  const said: string[] = [];
  let widget: unknown;

  const result = await find(name, context).run({
    rest: args.join(' '),
    args,
    conversationId: 'local-status',
    context,
    respond: async (content) => {
      if (typeof content === 'string') said.push(content);
      else {
        said.push(content.kind === 'widget' ? content.fallback : JSON.stringify(content));
        if (content.kind === 'widget') widget = content.widget;
      }
    },
  });
  return { result, said: said.join('\n'), widget };
};

/** Pulls every list item out of a widget tree, regardless of nesting. */
function itemsOf(widget: unknown): {
  title: string;
  subtitle?: string;
  actions?: { command: string }[];
}[] {
  const node = widget as { kind?: string; items?: unknown[]; children?: unknown[] };
  if (node?.kind === 'list') return (node.items ?? []) as ReturnType<typeof itemsOf>;
  return (node?.children ?? []).flatMap(itemsOf);
}

/** Pulls every row out of a widget tree, regardless of nesting. */
function rowsOf(widget: unknown): {
  label: string;
  value: string;
  actions?: { command: string }[];
}[] {
  const node = widget as { kind?: string; rows?: unknown[]; children?: unknown[] };
  if (node?.kind === 'rows') {
    return (node.rows ?? []) as ReturnType<typeof rowsOf>;
  }
  return (node?.children ?? []).flatMap(rowsOf);
}

const ETH: PluginSummary = {
  id: 'ethereum',
  name: 'Ethereum',
  description: 'Wallet',
  enabled: false,
};

describe('/commands', () => {
  it.each([undefined, 'ethereum'])(
    'lists every current-room command with owner %s',
    async (owner) => {
      const { widget } = await run('commands', [], makeContext([ETH], jest.fn(), owner));

      expect(
        itemsOf(widget).map((item) => ({
          title: item.title,
          commands: item.actions?.map((action) => action.command),
        }))
      ).toEqual([
        { title: '/commands', commands: ['/commands'] },
        { title: '/balance', commands: ['/balance'] },
      ]);
    }
  );

  it('does not add commands unavailable in the current room', async () => {
    const { widget } = await run(
      'commands',
      [],
      makeContext([ETH], jest.fn(), 'ethereum', [AVAILABLE_COMMANDS[0]!])
    );

    expect(itemsOf(widget).map((item) => item.title)).toEqual(['/commands']);
  });

  it.each(['ethereum', 'Ethereum Wallet', 'ETH'])(
    'filters available commands by plugin id, name or prefix: %s',
    async (arg) => {
      const { widget } = await run(
        'commands',
        [arg],
        makeContext([{ ...ETH, name: 'Ethereum Wallet' }])
      );

      expect(itemsOf(widget)).toEqual([
        expect.objectContaining({
          title: '/balance',
          actions: [expect.objectContaining({ command: '/balance' })],
        }),
      ]);
    }
  );

  it('rejects a known plugin whose commands are unavailable here', async () => {
    const { result, widget } = await run(
      'commands',
      ['ethereum'],
      makeContext([ETH], jest.fn(), undefined, [AVAILABLE_COMMANDS[0]!])
    );

    expect(result).toMatchObject({ type: 'error' });
    expect(widget).toBeUndefined();
  });

  it('rejects an unknown plugin without rendering unrelated commands', async () => {
    const { result, widget } = await run('commands', ['missing'], makeContext([ETH]));

    expect(result).toMatchObject({ type: 'error' });
    expect(widget).toBeUndefined();
  });

  it('keeps commands discoverable without plugin summaries', async () => {
    const { widget } = await run('commands', [], makeContext([]));
    const { widget: filtered } = await run('commands', ['ethereum'], makeContext([]));

    expect(itemsOf(widget).map((item) => item.title)).toEqual(['/commands', '/balance']);
    expect(itemsOf(filtered).map((item) => item.title)).toEqual(['/balance']);
  });
});

describe('/plugins', () => {
  it('marks enabled and disabled plugins distinctly', async () => {
    const { widget, said } = await run(
      'plugins',
      [],
      makeContext([ETH, { ...ETH, id: 'uniswap', name: 'Uniswap', enabled: true }])
    );

    expect(rowsOf(widget)).toEqual([
      expect.objectContaining({ label: 'Ethereum', value: '', state: 'off' }),
      expect.objectContaining({ label: 'Uniswap', value: '', state: 'on' }),
    ]);
    expect(said).toBe('1 of 2 plugins enabled');
  });

  it('offers exactly the opposite toggle on each plugin', async () => {
    const { widget } = await run(
      'plugins',
      [],
      makeContext([ETH, { ...ETH, id: 'uniswap', name: 'Uniswap', enabled: true }])
    );

    const [off, on] = rowsOf(widget);
    expect(off.actions?.map((a) => a.command)).toEqual(['/enable ethereum']);
    expect(on.actions?.map((a) => a.command)).toEqual(['/disable uniswap']);
  });
});

describe('/enable', () => {
  it('turns a plugin on and answers with a notice rather than a new card', async () => {
    const toggle = jest.fn();
    const context = makeContext([ETH], toggle);
    const { result, widget } = await run('enable', ['ethereum'], context);

    expect(toggle).toHaveBeenCalledWith('ethereum', true);
    expect(result).toEqual({ type: 'notice', tone: 'success', message: 'Ethereum is on' });
    expect(widget).toBeUndefined();
    expect(rowsOf((await run('plugins', [], context)).widget)).toContainEqual(
      expect.objectContaining({ label: 'Ethereum', state: 'on' })
    );
  });

  it('is case-insensitive about the id', async () => {
    const toggle = jest.fn();
    await run('enable', ['Ethereum'], makeContext([ETH], toggle));
    expect(toggle).toHaveBeenCalledWith('ethereum', true);
  });

  it('reports an unknown plugin instead of silently doing nothing', async () => {
    const toggle = jest.fn();
    const { result } = await run('enable', ['nope'], makeContext([ETH], toggle));

    expect(result).toEqual({ type: 'error', message: expect.stringContaining('No plugin called') });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('asks which plugin when given none', async () => {
    const { result } = await run('enable', [], makeContext([ETH]));
    expect(result).toMatchObject({ type: 'error' });
  });

  it('does not toggle a plugin that is already on', async () => {
    const toggle = jest.fn();
    const { result } = await run(
      'enable',
      ['ethereum'],
      makeContext([{ ...ETH, enabled: true }], toggle)
    );

    expect(toggle).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'notice', message: 'Ethereum was already on' });
  });
});

describe('/disable', () => {
  it('turns a plugin off and answers with a notice', async () => {
    const toggle = jest.fn();
    const context = makeContext([{ ...ETH, enabled: true }], toggle);
    const { result, widget } = await run('disable', ['ethereum'], context);

    expect(toggle).toHaveBeenCalledWith('ethereum', false);
    expect(widget).toBeUndefined();
    expect(result).toMatchObject({
      type: 'notice',
      message: expect.stringMatching(/^Ethereum is off/),
    });
    expect(rowsOf((await run('plugins', [], context)).widget)).toContainEqual(
      expect.objectContaining({ label: 'Ethereum', state: 'off' })
    );
  });
});
