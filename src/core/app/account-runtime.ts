import type { LocalAccount } from 'viem';

import type { AccountRecord } from '../identity/accounts';
import { reportError } from './report-error';
import type { DerivedKey, Keyring } from '../identity/keyring';
import { useAppearanceStore } from './appearance';
import { clearLinkPreviewCache, hydrateLinkPreviewCache } from '../messaging/link-preview-cache';
import { loadProtocolConfig, saveProtocolConfig, type ProtocolConfig } from '../messaging/config';
import {
  clearChatProjection,
  projectAccount,
  useChatStore,
  type ProtocolConnection,
} from '../messaging/chat-store';
import {
  botConversationId,
  SAVED_MESSAGES,
  toContent,
  type Bot,
  type BotContext,
} from '../messaging/bots';
import {
  namespacedId,
  namespaceConversation,
  namespaceMessage,
  type ProtocolId,
} from '../messaging/namespace';
import type { ChatSession, CustomContentType, XmtpCapabilities } from '../messaging/protocol';
import {
  effectiveConfig,
  isConfigured,
  transportProtocols,
  type ProtocolDescriptor,
} from '../messaging/registry';
import { loadChatPrefs } from '../messaging/chat-prefs';
import { draftSync, flushDrafts, loadDrafts } from '../messaging/drafts';
import { loadMediaIndex } from '../messaging/media-index';
import { readReadState } from '../messaging/read-state';
import type { MessageId, Unsubscribe } from '../messaging/types';
import type { PluginRegistry } from '../plugins/registry';
import { loadPluginPrefs, resolveEnabledIds, savePluginPrefs } from '../plugins/storage';
import type { Plugin, PluginContext, PluginId, PluginLease } from '../plugins/types';
import { createAccountStorage, type AccountStorage } from '@/storage/account';
import { eraseAccountStorage } from '@/storage/erase';
import { errorMessage } from '../errors';

export type SessionFactory = (params: {
  protocolId: ProtocolId;
  account: LocalAccount;
  derive(path: string): DerivedKey;
  contentTypes: CustomContentType[];
}) => Promise<ChatSession>;

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

interface RunningBot {
  stopped: boolean;
  dispose?: () => void;
}

interface OwnedPluginLease extends PluginLease {
  revoke(): void;
}

const PROACTIVE_MEMORY = 200;

export class AccountRuntime {
  private transition = Promise.resolve();
  private synchronization = Promise.resolve();
  private desired: RuntimeAccount | null = null;
  private generation = 0;
  private current: RuntimeAccount | null = null;
  private currentGeneration = 0;
  private storage: AccountStorage | null = null;
  private leases = new Set<OwnedPluginLease>();
  private subscriptions = new Map<ProtocolId, Unsubscribe[]>();
  private sessions = new Map<ProtocolId, ChatSession>();
  private bots = new Map<string, RunningBot>();
  private eraseSessions = new Map<
    string,
    Map<ProtocolId, ChatSession & Partial<XmtpCapabilities>>
  >();
  private proactiveIds: MessageId[] = [];

  constructor(private readonly descriptors: readonly ProtocolDescriptor[]) {}

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
      await this.stopSessions();
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
      if (!this.isCurrent(generation) || this.current?.accountId !== accountId) return;
      await this.reconnect(this.current, generation);
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
    return [...this.bots.keys()];
  }

  wasProactive(id: MessageId): boolean {
    return this.proactiveIds.includes(id);
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

    const [readAt, chatPrefs, drafts, mediaIndex, prefs] = await Promise.all([
      readReadState(storage),
      loadChatPrefs(storage),
      loadDrafts(storage),
      loadMediaIndex(storage),
      loadPluginPrefs(storage),
      useAppearanceStore.getState().hydrate(storage),
      hydrateLinkPreviewCache(storage),
    ]);
    if (!this.isCurrent(generation)) return;
    useChatStore.setState({ readAt, chatPrefs, drafts, mediaIndex });

    const enabled = resolveEnabledIds({
      all: input.registry.list().map((plugin) => plugin.manifest.id),
      defaults: input.defaultEnabled,
      prefs,
    });
    for (const id of enabled) {
      await this.activatePlugin(input, storage, generation, id);
      if (!this.isCurrent(generation)) return;
    }
    await this.publishPlugins(input, storage, generation);
    if (!this.isCurrent(generation)) return;
    await this.connectSessions(input, generation);
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
    await savePluginPrefs(storage, {
      enabled: ids,
      known: input.registry.list().map((plugin) => plugin.manifest.id),
    });
    if (!this.isCurrent(generation)) return;
    input.onPluginsChanged?.(ids);
    const bots = [...input.registry.bots(), SAVED_MESSAGES];
    await useChatStore.getState().registerBots(bots);
    if (this.isCurrent(generation)) this.syncBots(bots, input.accountId, generation);
  }

  private async connectSessions(
    input: RuntimeAccount,
    generation: number,
    only?: ProtocolId[]
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;
    useChatStore.setState({ status: 'connecting', error: null });
    const selected = input.only ?? (input.createSession ? ['xmtp' as const] : undefined);
    const descriptors = transportProtocols(this.descriptors).filter(
      (descriptor) =>
        (!selected || selected.includes(descriptor.id)) && (!only || only.includes(descriptor.id))
    );

    await Promise.all(
      descriptors.map(async (descriptor) => {
        if (!this.isCurrent(generation)) return;
        const protocolId = descriptor.id;
        const subscriptions: Unsubscribe[] = [];
        this.subscriptions.set(protocolId, subscriptions);
        this.setProtocol(protocolId, { status: 'connecting', error: null });
        try {
          let session: ChatSession;
          if (input.createSession) {
            session = await input.createSession({
              protocolId,
              account: input.keyring.account,
              derive: input.keyring.derive,
              contentTypes: input.registry.contentTypeSpecs(),
            });
          } else {
            const stored = await loadProtocolConfig(input.accountId, protocolId);
            if (!this.isCurrent(generation)) return;
            const config = effectiveConfig(descriptor, stored);
            if (!isConfigured(descriptor, config)) {
              this.setProtocol(protocolId, { status: 'idle', error: null });
              return;
            }
            session = await descriptor.connect!({
              accountId: input.accountId,
              account: input.keyring.account,
              derive: input.keyring.derive,
              contentTypes: input.registry.contentTypeSpecs(),
              config,
              storage: this.storage!,
            });
          }

          if (!this.isCurrent(generation)) {
            await session.disconnect().catch(() => {});
            return;
          }
          this.sessions.set(protocolId, session);
          useChatStore.setState((state) => ({
            sessions: { ...state.sessions, [protocolId]: session },
          }));
          this.setProtocol(protocolId, { status: 'ready', error: null });
          const live = () => this.isSession(generation, protocolId, session);

          if (session.subscribeHistory) {
            subscriptions.push(
              session.subscribeHistory((history) => {
                if (!live()) return;
                this.setProtocol(protocolId, {
                  ...useChatStore.getState().protocols[protocolId],
                  history,
                });
              })
            );
          }
          if (session.subscribeLogin) {
            subscriptions.push(
              session.subscribeLogin((login) => {
                if (!live()) return;
                this.setProtocol(protocolId, {
                  ...useChatStore.getState().protocols[protocolId],
                  login,
                });
              })
            );
          }
          const stopMessages = await session.streamMessages((message) => {
            if (live())
              useChatStore.getState().ingestMessage(namespaceMessage(protocolId, message));
          });
          if (!live()) {
            stopMessages();
            await session.disconnect().catch(() => {});
            return;
          }
          subscriptions.push(stopMessages);

          if (session.streamDeletedMessages) {
            const stopDeleted = await session.streamDeletedMessages((id, messageIds) => {
              if (live())
                useChatStore.getState().removeMessages(namespacedId(protocolId, id), messageIds);
            });
            if (!live()) {
              stopDeleted();
              await session.disconnect().catch(() => {});
              return;
            }
            subscriptions.push(stopDeleted);
          }

          const stopConversations = await session.streamConversations((conversation) => {
            if (live()) {
              useChatStore
                .getState()
                .ingestConversation(namespaceConversation(protocolId, conversation));
            }
          });
          if (!live()) {
            stopConversations();
            await session.disconnect().catch(() => {});
            return;
          }
          subscriptions.push(stopConversations);
          const conversations = await session.listConversations();
          if (!live()) return;
          useChatStore
            .getState()
            .ingestConversations(
              conversations.map((conversation) => namespaceConversation(protocolId, conversation))
            );
          await useChatStore.getState().syncProtocol(protocolId);
        } catch (error) {
          if (this.isCurrent(generation)) {
            this.setProtocol(protocolId, { status: 'error', error: errorMessage(error) });
          }
        }
      })
    );

    if (this.isCurrent(generation)) this.rollUpStatus();
  }

  private async stopCurrent(status: 'idle' | 'erasing' = 'idle'): Promise<void> {
    const current = this.current;
    this.current = null;
    this.currentGeneration = 0;
    this.revokeLeases();
    this.stopBots();
    await this.disconnectSessions();
    flushDrafts();
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
    await this.stopSessions(only);
    if (this.isCurrent(generation)) await this.connectSessions(current, generation, only);
  }

  /** Drops the network projection of `only` (every network by default) but keeps local chats. */
  private async stopSessions(only?: ProtocolId[]): Promise<void> {
    await this.disconnectSessions(only);
    const state = useChatStore.getState();
    const dropped = (protocol: string) => (only ? only.includes(protocol) : protocol !== 'local');
    const keep = <T>(record: Record<string, T>, protocolOf = (key: string) => key) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !dropped(protocolOf(key))));
    const conversationProtocol = (id: string) => id.slice(0, id.indexOf('-'));
    useChatStore.setState({
      status: only ? state.status : 'idle',
      error: only ? state.error : null,
      sessions: keep(state.sessions),
      protocols: keep(state.protocols),
      syncing: only ? state.syncing : false,
      conversations: state.conversations.filter(
        (conversation) => !dropped(conversation.protocol ?? '')
      ),
      messages: keep(state.messages, conversationProtocol),
      rawMessages: keep(state.rawMessages, conversationProtocol),
    });
  }

  private async disconnectSessions(only?: ProtocolId[]): Promise<void> {
    const ids = only ?? [...new Set([...this.subscriptions.keys(), ...this.sessions.keys()])];
    const sessions: ChatSession[] = [];
    for (const id of ids) {
      for (const unsubscribe of this.subscriptions.get(id) ?? []) {
        try {
          unsubscribe();
        } catch {}
      }
      this.subscriptions.delete(id);
      const session = this.sessions.get(id);
      if (session) sessions.push(session);
      this.sessions.delete(id);
    }
    await Promise.all(sessions.map((session) => session.disconnect().catch(() => {})));
  }

  private syncBots(bots: Bot[], accountId: string, generation: number): void {
    const wanted = new Map(bots.filter((bot) => bot.activate).map((bot) => [bot.id, bot]));
    for (const id of [...this.bots.keys()]) if (!wanted.has(id)) this.stopBot(id);
    for (const [id, bot] of wanted) {
      if (!this.bots.has(id)) this.startBot(bot, accountId, generation);
    }
  }

  private startBot(bot: Bot, accountId: string, generation: number): void {
    const conversationId = botConversationId(bot.id);
    const running: RunningBot = { stopped: false };
    this.bots.set(bot.id, running);
    const context: BotContext = {
      conversationId,
      say: async (content) => {
        if (running.stopped || !this.isCurrent(generation) || this.current?.accountId !== accountId)
          return;
        const chat = useChatStore.getState();
        if (!chat.conversations.some((conversation) => conversation.id === conversationId)) return;
        await chat.postLocalMessage(conversationId, toContent(content), 'bot');
        if (running.stopped || !this.isCurrent(generation) || this.current?.accountId !== accountId)
          return;
        const posted = useChatStore.getState().messages[conversationId]?.at(-1);
        if (posted) {
          this.proactiveIds.push(posted.id);
          if (this.proactiveIds.length > PROACTIVE_MEMORY) this.proactiveIds.shift();
        }
      },
    };
    Promise.resolve()
      .then(() => bot.activate?.(context))
      .then((dispose) => {
        if (typeof dispose !== 'function') return;
        if (running.stopped) dispose();
        else running.dispose = dispose;
      })
      .catch((error) => {
        console.warn(`[bots] "${bot.id}" failed to activate`, error);
        reportError(error);
        if (this.bots.get(bot.id) === running) this.stopBot(bot.id);
      });
  }

  private stopBots(): void {
    for (const id of [...this.bots.keys()]) this.stopBot(id);
  }

  private stopBot(id: string): void {
    const running = this.bots.get(id);
    if (!running) return;
    running.stopped = true;
    this.bots.delete(id);
    try {
      running.dispose?.();
    } catch (error) {
      console.warn(`[bots] "${id}" failed to stop`, error);
    }
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

  private isSession(generation: number, id: ProtocolId, session: ChatSession): boolean {
    return this.isCurrent(generation) && this.sessions.get(id) === session;
  }

  private setProtocol(id: ProtocolId, connection: ProtocolConnection): void {
    useChatStore.setState((state) => ({ protocols: { ...state.protocols, [id]: connection } }));
  }

  private rollUpStatus(): void {
    const state = useChatStore.getState();
    const connections = Object.values(state.protocols);
    const failures = connections.filter((connection) => connection.status === 'error');
    if (this.sessions.size > 0) {
      useChatStore.setState({ status: 'ready', error: failures[0]?.error ?? null });
    } else if (failures.length > 0) {
      useChatStore.setState({ status: 'error', error: failures[0].error });
    } else {
      useChatStore.setState({ status: 'idle', error: null });
    }
  }
}
