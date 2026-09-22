/**
 * Two independent gates decide what a conversation offers: `showIn` asks what
 * *kind* of place this is, ownership asks *whose room* it is. Both must pass.
 *
 * Gating happens before de-duplication, which is what lets every network
 * define its own `/balance`: in any one conversation at most one survives.
 */
import { reportError } from '../app/report-error';
import { botConversationId, type Bot } from '../messaging/bots';
import { inScope, type ConversationScope } from '../messaging/conversation-scope';
import type { ConversationId } from '../messaging/types';
import type {
  ActivePlugin,
  ComposerAction,
  Plugin,
  PluginContentType,
  PluginContext,
  PluginId,
  PluginOverlay,
  PluginView,
  SlashCommand,
} from './types';

interface CommandEntry {
  command: SlashCommand;
  context: PluginContext;
  pluginId: PluginId;
}

export const CORE_ID = 'status';

const CORE_CONTEXT = new Proxy({} as PluginContext, {
  get(_target, property) {
    throw new Error(
      `A core command reached for context.${String(property)}. Core commands have no plugin ` +
        'context: use the store directly, or make it a plugin.'
    );
  },
});

export interface CoreContribution {
  commands?: SlashCommand[];
  composerActions?: ComposerAction[];
}

function indexCommands(
  entries: Iterable<CommandEntry>,
  onClash?: (key: string, pluginId: PluginId) => void
): Map<string, CommandEntry> {
  const out = new Map<string, CommandEntry>();
  for (const entry of entries) {
    for (const key of [entry.command.name, ...(entry.command.aliases ?? [])]) {
      if (out.has(key)) onClash?.(key, entry.pluginId);
      else out.set(key, entry);
    }
  }
  return out;
}

export class PluginRegistry {
  private readonly available = new Map<PluginId, Plugin>();
  private readonly active = new Map<PluginId, ActivePlugin>();
  private readonly core: CoreContribution;

  private cache: {
    commands?: Map<string, CommandEntry>;
    contentTypes?: Map<string, { spec: PluginContentType; context: PluginContext }>;
    specs?: PluginContentType[];
    composerActions?: { action: ComposerAction; context: PluginContext; pluginId: PluginId }[];
    channelOwners?: Map<ConversationId, PluginId>;
    overlays?: { overlay: PluginOverlay; pluginId: PluginId }[];
    bots?: Bot[];
    lists?: Map<string, unknown>;
  } = {};

  private readonly listeners = new Set<() => void>();

  private invalidate() {
    this.cache = {};
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private memo<T>(key: string, compute: () => T): T {
    const lists = (this.cache.lists ??= new Map());
    if (!lists.has(key)) lists.set(key, compute());
    return lists.get(key) as T;
  }

  constructor(plugins: Plugin[] = [], core: CoreContribution = {}) {
    this.core = core;
    for (const plugin of plugins) this.register(plugin);
  }

  register(plugin: Plugin) {
    if (this.available.has(plugin.manifest.id)) {
      throw new Error(`Duplicate plugin id "${plugin.manifest.id}"`);
    }
    this.available.set(plugin.manifest.id, plugin);
  }

  list(): Plugin[] {
    return [...this.available.values()];
  }

  get(id: PluginId): Plugin | undefined {
    return this.available.get(id);
  }

  isActive(id: PluginId): boolean {
    return this.active.has(id);
  }

  activeIds(): PluginId[] {
    return [...this.active.keys()];
  }

  async activate(
    id: PluginId,
    makeContext: (plugin: Plugin) => PluginContext,
    revoke?: () => void
  ): Promise<void> {
    if (this.active.has(id)) return;

    const plugin = this.available.get(id);
    if (!plugin) throw new Error(`Unknown plugin "${id}"`);

    const context = makeContext(plugin);

    let contribution;
    try {
      contribution = plugin.setup(context);
    } catch (error) {
      revoke?.();
      console.error(`[plugins] "${id}" failed to set up and was skipped`, error);
      reportError(error);
      return;
    }

    const entry: ActivePlugin = { plugin, contribution, context, revoke };
    this.active.set(id, entry);
    this.invalidate();

    if (contribution.start) {
      try {
        const dispose = await contribution.start();
        if (typeof dispose === 'function') {
          if (this.active.get(id) === entry) entry.dispose = dispose;
          else dispose();
        }
      } catch (error) {
        console.warn(`[plugins] "${id}" failed to start`, error);
      }
    }
  }

  async deactivate(id: PluginId): Promise<void> {
    const entry = this.active.get(id);
    if (!entry) return;
    entry.revoke?.();
    try {
      entry.dispose?.();
    } catch (error) {
      console.warn(`[plugins] "${id}" failed to dispose`, error);
    }
    this.active.delete(id);
    this.invalidate();
  }

  async deactivateAll(): Promise<void> {
    await Promise.all(this.activeIds().map((id) => this.deactivate(id)));
  }

  commands(): Map<string, CommandEntry> {
    this.cache.commands ??= indexCommands(this.entries(), (key, pluginId) => {
      console.warn(`[plugins] command "/${key}" already claimed; "${pluginId}" ignored`);
    });
    return this.cache.commands;
  }

  channelOwner(conversationId: ConversationId): PluginId | undefined {
    if (!this.cache.channelOwners) {
      const owners = new Map<ConversationId, PluginId>();
      for (const [pluginId, entry] of this.active) {
        for (const bot of entry.contribution.bots ?? []) {
          owners.set(botConversationId(bot.id), pluginId);
        }
      }
      this.cache.channelOwners = owners;
    }
    return this.cache.channelOwners.get(conversationId);
  }

  private inScope(conversationId: ConversationId, pluginId: PluginId, global?: boolean): boolean {
    const owner = this.channelOwner(conversationId);
    return owner === undefined || owner === pluginId || global === true;
  }

  commandsFor(
    conversationId: ConversationId,
    scope?: ConversationScope
  ): Map<string, CommandEntry> {
    return indexCommands(this.entries(conversationId, scope));
  }

  commandListFor(
    conversationId: ConversationId,
    scope?: ConversationScope
  ): { command: SlashCommand; pluginId: PluginId }[] {
    return this.memo(`commands:${conversationId}:${scope}`, () => {
      const seen = new Set<string>();
      const out: { command: SlashCommand; pluginId: PluginId }[] = [];
      for (const { command, pluginId } of this.entries(conversationId, scope)) {
        // Hidden only from the list. `commandsFor` still dispatches it, which is
        // the point: a bot's buttons must keep working.
        if (command.hidden || seen.has(command.name)) continue;
        seen.add(command.name);
        out.push({ command, pluginId });
      }
      return out.sort((a, b) => a.command.name.localeCompare(b.command.name));
    });
  }

  /** Core first, then plugins. No scope skips the `showIn` gate; no conversation skips ownership. */
  private *entries(
    conversationId?: ConversationId,
    scope?: ConversationScope
  ): Generator<CommandEntry> {
    for (const command of this.core.commands ?? []) {
      if (scope !== undefined && !inScope(command.showIn, scope)) continue;
      yield { command, context: CORE_CONTEXT, pluginId: CORE_ID };
    }
    for (const [pluginId, entry] of this.active) {
      for (const command of entry.contribution.commands ?? []) {
        if (!this.offers(conversationId, pluginId, command.global, command.showIn, scope)) continue;
        yield { command, context: entry.context, pluginId };
      }
    }
  }

  composerActionsFor(
    conversationId: ConversationId,
    scope?: ConversationScope
  ): { action: ComposerAction; context: PluginContext; pluginId: PluginId }[] {
    return this.memo(`actions:${conversationId}:${scope}`, () => {
      const core = (this.core.composerActions ?? [])
        .filter((action) => scope === undefined || inScope(action.showIn, scope))
        .map((action) => ({ action, context: CORE_CONTEXT, pluginId: CORE_ID }));

      return [
        ...core,
        ...this.composerActions().filter((e) =>
          this.offers(conversationId, e.pluginId, e.action.global, e.action.showIn, scope)
        ),
      ];
    });
  }

  private offers(
    conversationId: ConversationId | undefined,
    pluginId: PluginId,
    global: boolean | undefined,
    showIn: readonly ConversationScope[] | undefined,
    scope: ConversationScope | undefined
  ): boolean {
    if (scope !== undefined && !inScope(showIn, scope)) return false;
    return conversationId === undefined || this.inScope(conversationId, pluginId, global);
  }

  contentTypes(): Map<string, { spec: PluginContentType; context: PluginContext }> {
    if (this.cache.contentTypes) return this.cache.contentTypes;
    const out = new Map<string, { spec: PluginContentType; context: PluginContext }>();
    for (const entry of this.active.values()) {
      for (const spec of entry.contribution.contentTypes ?? []) {
        out.set(spec.typeId, { spec, context: entry.context });
      }
    }
    this.cache.contentTypes = out;
    return out;
  }

  /** Plain data, not transport codecs: turning these into codecs is each adapter's job. */
  contentTypeSpecs(): PluginContentType[] {
    if (this.cache.specs) return this.cache.specs;
    this.cache.specs = [...this.contentTypes().values()].map(({ spec }) => spec);
    return this.cache.specs;
  }

  botsOf(id: PluginId): Bot[] {
    return this.active.get(id)?.contribution.bots ?? [];
  }

  view(pluginId: PluginId, name: string): PluginView | undefined {
    return this.active.get(pluginId)?.contribution.views?.[name];
  }

  bots(): Bot[] {
    if (this.cache.bots) return this.cache.bots;
    const out: Bot[] = [];
    for (const entry of this.active.values()) {
      out.push(...(entry.contribution.bots ?? []));
    }
    this.cache.bots = out;
    return out;
  }

  composerActions(): { action: ComposerAction; context: PluginContext; pluginId: PluginId }[] {
    if (this.cache.composerActions) return this.cache.composerActions;
    const out: { action: ComposerAction; context: PluginContext; pluginId: PluginId }[] = [];
    for (const [pluginId, entry] of this.active) {
      for (const action of entry.contribution.composerActions ?? []) {
        out.push({ action, context: entry.context, pluginId });
      }
    }
    this.cache.composerActions = out;
    return out;
  }

  overlays(): { overlay: PluginOverlay; pluginId: PluginId }[] {
    if (this.cache.overlays) return this.cache.overlays;
    const out: { overlay: PluginOverlay; pluginId: PluginId }[] = [];
    for (const [pluginId, entry] of this.active) {
      for (const overlay of entry.contribution.overlays ?? []) out.push({ overlay, pluginId });
    }
    this.cache.overlays = out;
    return out;
  }

  async handleUri(url: string): Promise<boolean> {
    const scheme = url.split(':')[0]?.toLowerCase();
    if (!scheme) return false;

    for (const entry of this.active.values()) {
      for (const handler of entry.contribution.uriHandlers ?? []) {
        if (!handler.schemes.includes(scheme)) continue;
        try {
          if (await handler.handle(url, entry.context)) return true;
        } catch (error) {
          console.warn(`[plugins] URI handler failed for ${scheme}:`, error);
        }
      }
    }
    return false;
  }
}
