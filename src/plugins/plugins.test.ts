import { groupCommands, groupComposerActions } from '@/core/commands/group';
import { parseCommand } from '@/core/commands/parser';
import { PluginRegistry } from '@/core/plugins/registry';

import { ALL_PLUGINS, DEFAULT_ENABLED_PLUGINS } from './index';
import { STATUS_BOT_ID } from './assistant/bot';
import { NETWORKS, networkById } from './wallet/networks';

/**
 * Consistency guards for the plugin surface.
 *
 * These are cheap and catch the kind of drift that is invisible in review: a
 * new plugin that forgets a usage string, a command name that collides with an
 * existing one, an action pointing at a command nobody implements.
 */

const allCommands = ALL_PLUGINS.flatMap((plugin) => {
  const contribution = plugin.setup(stubContext());
  return (contribution.commands ?? []).map((command) => ({
    pluginId: plugin.manifest.id,
    command,
  }));
});

function stubContext() {
  const throwing = () => {
    throw new Error('not called during setup');
  };
  return {
    manifest: { id: 'x', name: 'x', description: '', version: '1', icon: 'ellipse', permissions: [] },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    identity: {
      address: '0x0000000000000000000000000000000000000000',
      participantId: '',
      signMessage: throwing,
      account: throwing,
      derive: throwing,
    },
    chat: {
      startDm: throwing,
      startGroup: throwing,
      send: throwing,
      sendText: throwing,
      sendCustom: throwing,
    },
    ui: {
      notify: () => {},
      openExternalUrl: throwing,
      openConversation: () => {},
      openProfile: () => {},
    },
    plugins: { list: () => [], setEnabled: throwing, commands: () => [] },
  } as never;
}

describe('every plugin', () => {
  it.each(ALL_PLUGINS.map((p) => [p.manifest.id, p] as const))(
    '%s has a complete manifest',
    (_id, plugin) => {
      const { manifest } = plugin;
      expect(manifest.id).toMatch(/^[a-z][a-z-]*$/);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.permissions.length).toBeGreaterThan(0);
    }
  );

  it.each(ALL_PLUGINS.map((p) => [p.manifest.id, p] as const))(
    '%s contributes something',
    (_id, plugin) => {
      const c = plugin.setup(stubContext());
      const contributes =
        (c.commands?.length ?? 0) +
        (c.bots?.length ?? 0) +
        (c.contentTypes?.length ?? 0) +
        (c.overlays?.length ?? 0) +
        (c.uriHandlers?.length ?? 0);
      expect(contributes).toBeGreaterThan(0);
    }
  );
});

describe('every command', () => {
  it('has a valid usage line', () => {
    for (const { command } of allCommands) {
      expect(command.usage.startsWith('/')).toBe(true);
      expect(command.usage).toContain(command.name);
    }
  });

  it('resolves a shared name to the room you are standing in', () => {
    // Two plugins may declare the same name. What has to hold is that in any
    // given conversation the name resolves to the command you would expect
    // and nothing is silently shadowed, so this asks the registry.
    const registry = new PluginRegistry(ALL_PLUGINS);
    for (const plugin of ALL_PLUGINS) registry.activate(plugin.manifest.id, stubContext);

    const duplicated = new Map<string, Set<string>>();
    for (const { pluginId, command } of allCommands) {
      for (const key of [command.name, ...(command.aliases ?? [])]) {
        duplicated.set(key, new Set([...(duplicated.get(key) ?? []), pluginId]));
      }
    }

    for (const [key, owners] of duplicated) {
      if (owners.size === 1) continue;

      // Inside a plugin's own room, its own command wins. A plugin with no
      // room is skipped: there is no such conversation, and an unowned channel
      // offers everything by design, so the assertion would be about a thread
      // nobody can open.
      for (const owner of owners) {
        const room = channelIdOf(owner);
        if (!room) continue;
        const resolved = registry.commandsFor(`local-${room}`, 'channel').get(key);
        if (resolved) expect(resolved.pluginId).toBe(owner);
      }

      // Outside every room no plugin's room breaks the tie, so at most one
      // may claim the name.
      const inDm = [...owners].filter((owner) =>
        registry.commandsFor('xmtp-abc', 'dm').get(key)?.pluginId === owner
      );
      expect(inDm.length).toBeLessThanOrEqual(1);
    }
  });

  /**
   * Whatever a conversation dispatches, it also offers. Both sides are read
   * with the same scope, so a command typed in full cannot run somewhere it
   * was never listed.
   *
   * `hidden` is the one sanctioned asymmetry, and it goes the safe way round:
   * a hidden command runs but is never listed, so nothing can be offered that
   * would not run.
   */
  it.each(['dm', 'group', 'channel'] as const)(
    'dispatches only what it offers in a %s',
    (scope) => {
      const registry = activeRegistry();

      const conversations =
        scope === 'channel' ? registry.bots().map((bot) => `local-${bot.id}`) : ['xmtp-abc'];
      for (const conversation of conversations) {
        const offered = new Set(
          registry.commandListFor(conversation, scope).map(({ command }) => command.name)
        );
        for (const [name, entry] of registry.commandsFor(conversation, scope)) {
          expect(parseCommand(`/${name}`)).toEqual({ name, rest: '', args: [] });
          expect(offered.has(entry.command.name)).toBe(!entry.command.hidden);
        }
      }
    }
  );

  /**
   * A chip is only offered where the command behind it works. The composer
   * chip and the command it dispatches carry their own `showIn`, so the two
   * can disagree and leave a chip that cannot do its one job.
   */
  it.each(['dm', 'group', 'channel'] as const)(
    'only offers a chip in a %s when its command runs there',
    (scope) => {
      const registry = activeRegistry();

      // Every room, because a chip is gated by the plugin that owns the room
      // it sits in; checking a single channel would leave every other
      // plugin's chips unchecked.
      const conversations =
        scope === 'channel'
          ? ALL_PLUGINS.flatMap((plugin) =>
              (plugin.setup(stubContext() as never).bots ?? []).map((bot) => `local-${bot.id}`)
            )
          : ['xmtp-abc'];

      for (const conversation of conversations) {
        const runnable = registry.commandsFor(conversation, scope);
        const offered = new Set(
          registry.commandListFor(conversation, scope).map(({ command }) => command.name)
        );

        for (const { action } of registry.composerActionsFor(conversation, scope)) {
          const parsed = parseCommand(action.command);
          const entry = parsed ? runnable.get(parsed.name) : undefined;
          expect({
            chip: action.id,
            scope,
            callable: Boolean(entry),
            discoverable: entry ? offered.has(entry.command.name) : false,
          }).toEqual({
            chip: action.id,
            scope,
            callable: true,
            discoverable: true,
          });
        }
      }
    }
  );

  it.each([
    ['bots', 'addbot'],
    ['markets', 'alert'],
  ])('prompts for arguments to /%s /%s without performing the action', async (pluginId, name) => {
    const context = stubContext();
    const command = ALL_PLUGINS.find((plugin) => plugin.manifest.id === pluginId)!
      .setup(context).commands!.find((candidate) => candidate.name === name)!;
    const respond = jest.fn();

    expect(await command.run({
      args: [],
      rest: '',
      conversationId: `local-${pluginId}`,
      context,
      respond,
    })).toEqual({ type: 'setComposer', text: `/${name} ` });
    expect(respond).not.toHaveBeenCalled();
  });

  /**
   * A button in a room runs in *that* room. A command can exist somewhere and
   * still belong to another plugin's room, in which case tapping the button
   * only answers "that belongs to X".
   *
   * Greetings are the part that can be checked statically: they are built at
   * setup, before anything has been asked.
   */
  it('never offers a button its own room cannot run', () => {
    const registry = activeRegistry();
    const wrong: string[] = [];

    for (const plugin of ALL_PLUGINS) {
      const contribution = plugin.setup(stubContext() as never);
      for (const bot of contribution.bots ?? []) {
        const room = `local-${bot.id}`;
        const runnable = registry.commandsFor(room, 'channel');

        for (const line of bot.greeting()) {
          if (typeof line === 'string' || line.kind !== 'widget') continue;
          for (const command of commandsIn(line.widget)) {
            // `/draft /x ` hands `/x` to the composer; that is the one that
            // has to run here.
            const name = command.replace(/^\/draft\s+/, '').replace(/^\//, '').split(/\s/)[0];
            if (!runnable.has(name)) wrong.push(`${bot.id}: /${name}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * Inside a plugin's room, every command belongs to that plugin or is app
   * furniture. Checked as a property rather than a list so it holds for rooms
   * that do not exist yet. Additions that look local break it, such as a
   * command marked global to satisfy its own chip.
   */
  it('never leaks a foreign command into a plugin room', () => {
    const registry = activeRegistry();

    // The app's own furniture: reachable from every room by design.
    const FURNITURE = ['commands'];

    for (const plugin of ALL_PLUGINS) {
      const contribution = plugin.setup(stubContext() as never);
      for (const bot of contribution.bots ?? []) {
        const foreign = registry
          .commandListFor(`local-${bot.id}`, 'channel')
          .filter((e) => e.pluginId !== plugin.manifest.id)
          .filter((e) => !FURNITURE.includes(e.command.name))
          .map((e) => `/${e.command.name} from ${e.pluginId}`);

        expect({ room: bot.id, foreign }).toEqual({ room: bot.id, foreign: [] });
      }
    }
  });

  /**
   * What a conversation with a person offers, pinned.
   *
   * Brittle on purpose: `showIn` is optional and "undefined means everywhere"
   * is a default that fails quietly (market alerts in a DM, the plugin
   * switchboard in someone's chat). Adding a command to this list should be a
   * decision, and a decision leaves a diff.
   */
  it.each([
    [
      // Everything here involves the person on the other side: pay them, ask
      // them, tell them where to pay you, look up who they are.
      'dm',
      ['address', 'balance', 'commands', 'ens', 'profile', 'request', 'send'],
    ],
    [
      // The same, plus the group's own management. That is core: you cannot
      // opt out of seeing who is in a group.
      'group',
      ['address', 'balance', 'commands', 'ens', 'invite', 'leave', 'members',
       'profile', 'remove', 'rename', 'request', 'send', 'split'],
    ],
  ] as const)('offers exactly the agreed set in a %s', (scope, expected) => {
    const registry = activeRegistry();

    const offered = registry
      .commandListFor('xmtp-abc', scope)
      .map(({ command }) => command.name)
      .sort();

    expect(offered).toEqual([...expected]);
  });

  /**
   * Every network that ships can be sent from, and says how. `/send` asks the
   * strategy registry, so a network that forgets to declare `transfer`
   * disappears from the picker silently.
   *
   * Checked on the strategy rather than through `start()`, because networks
   * are one plugin's setting, registered as a set when the Wallet plugin
   * starts.
   */
  it('lets every network send its own coin', () => {
    expect(NETWORKS.map((n) => n.id).sort()).toEqual([
      'arbitrum',
      'arbitrum-sepolia',
      'base',
      'base-sepolia',
      'bitcoin',
      'ethereum',
      'optimism',
      'optimism-sepolia',
      'polygon',
      'sepolia',
      'solana',
    ]);

    for (const network of NETWORKS) {
      const strategy = network.strategy(stubContext() as never);
      expect({ id: network.id, sends: typeof strategy.transfer?.commit }).toEqual({
        id: network.id,
        sends: 'function',
      });
      // A balance a card cannot read is a network the room cannot show.
      expect({ id: network.id, reads: typeof strategy.balance }).toEqual({
        id: network.id,
        reads: 'function',
      });
    }
  });

/** Every command string a widget's buttons carry, however deeply nested. */
function commandsIn(widget: unknown): string[] {
  const node = widget as {
    kind?: string;
    command?: string;
    actions?: { command: string }[];
    rows?: { actions?: { command: string }[] }[];
    items?: { actions?: { command: string }[] }[];
    submit?: { command: string };
    children?: unknown[];
  };
  if (!node || typeof node !== 'object') return [];

  return [
    ...(node.actions ?? []).map((a) => a.command),
    ...(node.rows ?? []).flatMap((r) => (r.actions ?? []).map((a) => a.command)),
    ...(node.items ?? []).flatMap((i) => (i.actions ?? []).map((a) => a.command)),
    ...(node.submit ? [node.submit.command] : []),
    ...(node.children ?? []).flatMap(commandsIn),
  ];
}

/**
 * The registry as the app builds it: every plugin active, plus the core
 * commands the app contributes itself. A test that leaves those out is
 * measuring a conversation nobody has.
 */
function activeRegistry(): PluginRegistry {
  const registry = new PluginRegistry(ALL_PLUGINS, {
    commands: groupCommands,
    composerActions: groupComposerActions,
  });
  for (const plugin of ALL_PLUGINS) {
    registry.activate(plugin.manifest.id, () => stubContext() as never);
  }
  return registry;
}

/** The plugin's own room, or null when it has none. */
function channelIdOf(pluginId: string): string | null {
  const plugin = ALL_PLUGINS.find((p) => p.manifest.id === pluginId);
  return plugin?.setup(stubContext()).bots?.[0]?.id ?? null;
}
});

const allBots = ALL_PLUGINS.flatMap((plugin) =>
  (plugin.setup(stubContext()).bots ?? []).map((bot) => ({ pluginId: plugin.manifest.id, bot }))
);

describe('every bot', () => {
  it('has a unique id', () => {
    // A bot id becomes the conversation id, so a collision silently hands two
    // plugins the same thread and the same persisted transcript.
    const seen = new Map<string, string>();
    for (const { pluginId, bot } of allBots) {
      expect(seen.has(bot.id)).toBe(false);
      seen.set(bot.id, pluginId);
    }
  });

  it('has an id that survives being a URL path segment', () => {
    for (const { bot } of allBots) expect(bot.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('introduces itself', () => {
    for (const { bot } of allBots) {
      // The greeting is the only thing in the conversation on first run; an
      // empty one leaves a chat row that opens onto nothing.
      expect(bot.greeting().length).toBeGreaterThan(0);
      expect(bot.tagline.length).toBeGreaterThan(0);
    }
  });

  it('either speaks first or answers back', () => {
    for (const { bot } of allBots) {
      if (bot.id === STATUS_BOT_ID) continue;
      expect(Boolean(bot.activate) || Boolean(bot.onMessage)).toBe(true);
    }
  });
});

describe('defaults', () => {
  it('only enables plugins that exist', () => {
    const ids = new Set(ALL_PLUGINS.map((p) => p.manifest.id));
    for (const id of DEFAULT_ENABLED_PLUGINS) expect(ids.has(id)).toBe(true);
  });

  /**
   * Nothing optional is on before anyone asks for it. Adding a plugin is
   * exactly the moment someone reaches for this list, and a default that grows
   * one plugin at a time is how an app that starts as a messenger ends up
   * shipping ten chain rooms nobody chose.
   *
   * The two here are not optional: `assistant` provides the Status
   * conversation and `profile` the core identity commands.
   */
  it('starts with nothing optional switched on', () => {
    expect([...DEFAULT_ENABLED_PLUGINS].sort()).toEqual(['assistant', 'profile']);
  });
});

/**
 * Networks are one plugin's setting, so a command has to be told its chain,
 * and a chain that answers the wrong question (Bitcoin resolving a name to
 * its Ethereum record, say) costs real money.
 */
describe('every network', () => {
  function stub() {
    return stubContext() as never;
  }

  it('is reachable by name and by id', () => {
    for (const network of NETWORKS) {
      expect(networkById(network.id)?.id).toBe(network.id);
      expect(networkById(network.name)?.id).toBe(network.id);
      expect(networkById(network.name.toUpperCase())?.id).toBe(network.id);
    }
    expect(networkById('bass')).toBeUndefined();
  });

  it('says which addresses are its own', () => {
    const evm = '0x0000000000000000000000000000000000000001';
    const btc = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    const strategyOf = (id: string) => NETWORKS.find((n) => n.id === id)!.strategy(stub());

    expect(strategyOf('ethereum').isAddress(evm)).toBe(true);
    expect(strategyOf('ethereum').isAddress(btc)).toBe(false);
    expect(strategyOf('bitcoin').isAddress(btc)).toBe(true);
    expect(strategyOf('bitcoin').isAddress(evm)).toBe(false);
  });

  /**
   * ENSIP-9 gives a name one record per coin. Reading the Ethereum record and
   * sending bitcoin to it would burn the money, so Bitcoin must not share the
   * EVM resolver. This pins that they are different functions; checking that
   * they return different values needs a network.
   */
  it('resolves names its own way, or not at all', () => {
    const resolvers = Object.fromEntries(
      NETWORKS.map((n) => [n.id, n.strategy(stub()).resolve])
    );

    expect(typeof resolvers.ethereum).toBe('function');
    expect(typeof resolvers.bitcoin).toBe('function');
    expect(resolvers.ethereum).not.toBe(resolvers.bitcoin);
    // Solana has no ENS record to read, and guessing one would be worse.
    expect(resolvers.solana).toBeUndefined();
  });

  it('only lets viem-backed networks be watched', () => {
    const evmIds = NETWORKS.filter((n) => n.evm).map((n) => n.id);
    expect(evmIds).toEqual([
      'ethereum',
      'base',
      'optimism',
      'arbitrum',
      'polygon',
      'sepolia',
      'optimism-sepolia',
      'base-sepolia',
      'arbitrum-sepolia',
    ]);
  });
});
