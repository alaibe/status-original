import type { AccountRecord } from '../identity/accounts';
import { reportError } from './report-error';
import type { Keyring } from '../identity/keyring';
import { useAppearanceStore } from './appearance';
import { clearLinkPreviewCache, hydrateLinkPreviewCache } from '../messaging/link-preview-cache';
import { loadProtocolConfig, saveProtocolConfig, type ProtocolConfig } from '../messaging/config';
import {
  clearChatProjection,
  projectAccount,
  showCachedConversations,
  useChatStore,
} from '../messaging/chat-store';
import { ConversationCache } from '../messaging/conversation-cache';
import { SAVED_MESSAGES } from '../messaging/bots';
import type { ProtocolId } from '../messaging/namespace';
import type { ChatSession, XmtpCapabilities } from '../messaging/protocol';
import type { ProtocolDescriptor } from '../messaging/registry';
import { loadChatPrefs } from '../messaging/chat-prefs';
import { draftSync, flushDrafts, loadDrafts } from '../messaging/drafts';
import { flushMediaIndex, loadMediaIndex } from '../messaging/media-index';
import { readReadState } from '../messaging/read-state';
import type { MessageId } from '../messaging/types';
import type { PluginRegistry } from '../plugins/registry';
import { loadPluginPrefs, resolveEnabledIds, savePluginPrefs } from '../plugins/storage';
import type { Plugin, PluginContext, PluginId, PluginLease } from '../plugins/types';
import { createAccountStorage, type AccountStorage } from '@/storage/account';
import { eraseAccountStorage } from '@/storage/erase';
import { BotRuntime } from './bot-runtime';
import { ProtocolRuntime, type SessionFactory } from './protocol-runtime';

export type { SessionFactory } from './protocol-runtime';

const BOTS_WAIT_MS = 15_000;

export interface RuntimeAccount {
  accountId: string;
  keyring: Keyring;
  registry: PluginRegistry;
  defaultEnabled: PluginId[];
  makeContext(
    plugin: Plugin,
    accountId: string,
    keyring: Keyring,
    storage: AccountStorage,
    lease: PluginLease
  ): PluginContext;
  onPluginsChanged?(ids: PluginId[]): void;
  createSession?: SessionFactory;
  only?: ProtocolId[];
  storage?: AccountStorage;
}

interface OwnedPluginLease extends PluginLease {
  revoke(): void;
}

export class AccountRuntime {
  private transition = Promise.resolve();
  private synchronization = Promise.resolve();
  private desired: RuntimeAccount | null = null;
  private generation = 0;
  private current: RuntimeAccount | null = null;
  private currentGeneration = 0;
  private storage: AccountStorage | null = null;
  private cache: ConversationCache | null = null;
  private stopCaching: (() => void) | null = null;
  private leases = new Set<OwnedPluginLease>();
  private protocols: ProtocolRuntime;
  private bots = new BotRuntime();
  private eraseSessions = new Map<
    string,
    Map<ProtocolId, ChatSession & Partial<XmtpCapabilities>>
  >();

  constructor(private readonly descriptors: readonly ProtocolDescriptor[]) {
    this.protocols = new ProtocolRuntime(descriptors);
  }

  synchronize(next: RuntimeAccount | null): Promise<void> {
    if (this.sameRuntime(this.desired, next)) {
      this.desired = next;
      if (this.current && next) this.current = next;
      return this.synchronization;
    }

    const generation = this.advance(next);
    let startup = Promise.resolve();
    const prepared = this.serialize(async () => {
      if (!this.isDesired(generation)) return;
      await this.stopCurrent();
      if (!this.isDesired(generation) || !next) return;
      startup = this.start(next, generation);
    });
    const synchronization = prepared.then(() => startup);
    this.synchronization = synchronization;
    void synchronization.catch(() => {});
    return synchronization;
  }

  restart(): Promise<void> {
    return this.serialize(async () => {
      const current = this.current;
      const generation = this.currentGeneration;
      if (!current || !this.isCurrent(generation)) return;
      await this.reconnect(current, generation);
    });
  }

  disconnect(): Promise<void> {
    return this.serialize(async () => {
      if (!this.current || !this.isCurrent(this.currentGeneration)) return;
      await this.protocols.stop();
    });
  }

  setPluginEnabled(id: PluginId, enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      const current = this.current;
      const storage = this.storage;
      const generation = this.currentGeneration;
      if (!current || !storage || !this.isCurrent(generation)) return;
      const plugin = current.registry.get(id);
      if (!plugin) return;

      if (enabled) {
        await this.activatePlugin(current, storage, generation, id);
      } else {
        await current.registry.deactivate(id);
      }
      if (!this.isCurrent(generation)) return;

      await this.publishPlugins(current, storage, generation);
      if (!this.isCurrent(generation) || !plugin.manifest.requiresSessionRestart) return;
      const affected = this.descriptors
        .filter((descriptor) => descriptor.usesPluginContentTypes)
        .map((descriptor) => descriptor.id);
      void this.serialize(() => this.reconnect(current, generation, affected)).catch(reportError);
    });
  }

  updateProtocolConfig(
    accountId: string,
    protocolId: ProtocolId,
    config: ProtocolConfig
  ): Promise<void> {
    return this.serialize(async () => {
      const generation = this.currentGeneration;
      await saveProtocolConfig(accountId, protocolId, config);
      const current = this.current;
      if (!current || !this.isCurrent(generation) || current.accountId !== accountId) return;
      void this.serialize(() => this.reconnect(current, generation, [protocolId])).catch(
        reportError
      );
    });
  }

  erase(account: AccountRecord): Promise<void> {
    const projected = useChatStore.getState();
    const active =
      this.desired?.accountId === account.id ||
      this.current?.accountId === account.id ||
      projected.accountId === account.id;
    const retained = this.eraseSessions.get(account.id) ?? new Map();
    if (active) {
      for (const descriptor of this.descriptors.filter((entry) => entry.eraseLocalData)) {
        const session = projected.sessions[descriptor.id] as
          | (ChatSession & Partial<XmtpCapabilities>)
          | undefined;
        if (session) retained.set(descriptor.id, session);
      }
      if (retained.size > 0) this.eraseSessions.set(account.id, retained);
      this.advance(null, 'erasing');
    }

    return this.serialize(async () => {
      if (active) {
        await this.stopCurrent('erasing');
      }

      try {
        for (const descriptor of this.descriptors.filter((entry) => entry.eraseLocalData)) {
          const session = retained.get(descriptor.id);
          if (session?.eraseLocalDatabase) {
            await session.eraseLocalDatabase();
          } else {
            await descriptor.eraseLocalData!({
              accountId: account.id,
              address: account.address,
              config: await loadProtocolConfig(account.id, descriptor.id),
            });
          }
        }
        await eraseAccountStorage(account.id);
        this.eraseSessions.delete(account.id);
      } catch (error) {
        if (active) useChatStore.setState({ status: 'erasing' });
        throw error;
      }

      if (active) clearChatProjection();
    });
  }

  runningBotIds(): string[] {
    return this.bots.ids();
  }

  wasProactive(id: MessageId): boolean {
    return this.bots.wasProactive(id);
  }

  private serialize(run: () => Promise<void>): Promise<void> {
    const next = this.transition.then(run, run);
    this.transition = next.catch(() => {});
    return next;
  }

  private async start(input: RuntimeAccount, generation: number): Promise<void> {
    if (!this.isDesired(generation)) return;
    this.current = input;
    this.currentGeneration = generation;
    const storage = input.storage ?? createAccountStorage(input.accountId);
    this.storage = storage;
    projectAccount(storage);
    const cache = new ConversationCache(storage.messages);

    const [readAt, chatPrefs, drafts, mediaIndex, prefs, , , cached] = await Promise.all([
      readReadState(storage),
      loadChatPrefs(storage),
      loadDrafts(storage),
      loadMediaIndex(storage),
      loadPluginPrefs(storage),
      useAppearanceStore.getState().hydrate(storage),
      hydrateLinkPreviewCache(storage),
      cache.restore(),
    ]);
    if (!this.isCurrent(generation)) return;
    useChatStore.setState({ readAt, chatPrefs, drafts, mediaIndex });
    showCachedConversations(cached);
    this.cache = cache;
    this.stopCaching = useChatStore.subscribe((state, previous) => {
      if (state.accountId !== input.accountId || state.conversations === previous.conversations)
        return;
      cache.saveSoon(state.conversations);
    });

    const enabled = resolveEnabledIds({
      all: input.registry.list().map((plugin) => plugin.manifest.id),
      defaults: input.defaultEnabled,
      prefs,
    });
    const plugins = this.startPlugins(input, storage, generation, enabled);
    const connecting = this.connectSessions(
      input,
      generation,
      undefined,
      plugins.catch(() => {})
    );
    this.bots.holdUntil(
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, BOTS_WAIT_MS);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        connecting.then(done, done);
      })
    );
    await Promise.all([plugins, connecting]);
  }

  private async startPlugins(
    input: RuntimeAccount,
    storage: AccountStorage,
    generation: number,
    enabled: PluginId[]
  ): Promise<void> {
    await Promise.all(enabled.map((id) => this.activatePlugin(input, storage, generation, id)));
    if (!this.isCurrent(generation)) return;
    await this.publishPlugins(input, storage, generation);
  }

  private async activatePlugin(
    input: RuntimeAccount,
    storage: AccountStorage,
    generation: number,
    id: PluginId
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;
    if (input.registry.isActive(id)) return;
    const lease = this.createLease(input, generation, id);
    await input.registry.activate(
      id,
      (plugin) => input.makeContext(plugin, input.accountId, input.keyring, storage, lease),
      lease.revoke
    );
    if (!input.registry.isActive(id)) lease.revoke();
  }

  private async publishPlugins(
    input: RuntimeAccount,
    storage: AccountStorage,
    generation: number
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;
    const ids = input.registry.activeIds();
    await savePluginPrefs(storage, { enabled: ids });
    if (!this.isCurrent(generation)) return;
    input.onPluginsChanged?.(ids);
    const bots = [...input.registry.bots(), SAVED_MESSAGES];
    await useChatStore.getState().registerBots(bots);
    if (this.isCurrent(generation)) {
      this.bots.sync(
        bots,
        () => this.isCurrent(generation) && this.current?.accountId === input.accountId
      );
    }
  }

  private connectSessions(
    input: RuntimeAccount,
    generation: number,
    only?: ProtocolId[],
    plugins: Promise<void> = Promise.resolve()
  ): Promise<void> {
    return this.protocols.connect(
      {
        accountId: input.accountId,
        keyring: input.keyring,
        contentTypes: () => input.registry.contentTypeSpecs(),
        createSession: input.createSession,
        only: input.only,
        plugins,
        cache: this.cache ?? undefined,
      },
      this.storage!,
      () => this.isCurrent(generation),
      only
    );
  }

  private async stopCurrent(status: 'idle' | 'erasing' = 'idle'): Promise<void> {
    const current = this.current;
    this.current = null;
    this.currentGeneration = 0;
    this.stopCaching?.();
    this.stopCaching = null;
    if (status !== 'erasing') void this.cache?.flush();
    this.cache = null;
    this.revokeLeases();
    this.bots.stop();
    await this.protocols.disconnect();
    await Promise.all([flushDrafts(), flushMediaIndex()]);
    draftSync.clear();
    useChatStore.setState({
      status,
      error: null,
      sessions: {},
      protocols: {},
      syncing: false,
      conversations: [],
      messages: {},
      rawMessages: {},
      messageHistory: {},
      bots: {},
      readAt: {},
      drafts: {},
    });
    if (current) await current.registry.deactivateAll();
    current?.onPluginsChanged?.([]);
    this.storage = null;
    if (status !== 'erasing') {
      clearChatProjection();
      useAppearanceStore.getState().clear();
      clearLinkPreviewCache();
    }
  }

  private async reconnect(
    current: RuntimeAccount,
    generation: number,
    only?: ProtocolId[]
  ): Promise<void> {
    await this.protocols.stop(only);
    if (this.isCurrent(generation)) await this.connectSessions(current, generation, only);
  }

  private advance(next: RuntimeAccount | null, status: 'idle' | 'erasing' = 'idle'): number {
    this.generation += 1;
    this.desired = next;
    this.revokeLeases();
    const accountId = useChatStore.getState().accountId;
    if (accountId !== (next?.accountId ?? null) || status === 'erasing') {
      clearChatProjection(status);
      useAppearanceStore.getState().clear();
      clearLinkPreviewCache();
    }
    return this.generation;
  }

  private createLease(
    input: RuntimeAccount,
    generation: number,
    pluginId: PluginId
  ): OwnedPluginLease {
    let revoked = false;
    const lease: OwnedPluginLease = {
      assertActive: () => {
        if (revoked || !this.isCurrent(generation) || this.current?.accountId !== input.accountId) {
          throw new Error(`Plugin "${pluginId}" is no longer active.`);
        }
      },
      guard: async <T>(run: () => Promise<T>): Promise<T> => {
        lease.assertActive();
        const result = await run();
        lease.assertActive();
        return result;
      },
      revoke: () => {
        if (revoked) return;
        revoked = true;
        this.leases.delete(lease);
      },
    };
    this.leases.add(lease);
    return lease;
  }

  private revokeLeases(): void {
    for (const lease of [...this.leases]) lease.revoke();
  }

  private sameRuntime(left: RuntimeAccount | null, right: RuntimeAccount | null): boolean {
    if (!left || !right) return left === right;
    return (
      left.accountId === right.accountId &&
      left.keyring === right.keyring &&
      left.registry === right.registry
    );
  }

  private isDesired(generation: number): boolean {
    return this.generation === generation;
  }

  private isCurrent(generation: number): boolean {
    return (
      this.current !== null && this.currentGeneration === generation && this.isDesired(generation)
    );
  }
}
