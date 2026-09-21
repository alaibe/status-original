import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { createContext, use, useState } from 'react';

import { capabilitiesOf } from '../identity/account-kind';
import type { Keyring } from '../identity/keyring';
import { groupCommands, groupComposerActions } from '../commands/group';
import { useChatStore, xmtpSessionFor } from '../messaging/chat-store';
import { conversationScope } from '../messaging/conversation-scope';
import { notifyLiveViews } from './live';
import { PluginRegistry } from './registry';
import type { Plugin, PluginContext, PluginId, PluginLease, PluginPermission } from './types';
import { toast } from '@/design';
import { accountRuntime } from '@/runtime';
import type { AccountStorage } from '@/storage/account';

const PLUGIN_PROTOCOL = 'xmtp';

interface PluginHostValue {
  registry: PluginRegistry;
  enabledIds: PluginId[];
  defaultEnabled: PluginId[];
  makeContext(
    plugin: Plugin,
    accountId: string,
    keyring: Keyring,
    storage: AccountStorage,
    lease: PluginLease,
  ): PluginContext;
  onPluginsChanged(ids: PluginId[]): void;
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  handleUri(url: string): Promise<boolean>;
}

const PluginHostContext = createContext<PluginHostValue | null>(null);

export function usePluginHost(): PluginHostValue {
  const value = use(PluginHostContext);
  if (!value) throw new Error('usePluginHost must be used inside <PluginProvider>');
  return value;
}

export interface PluginProviderProps {
  plugins: Plugin[];
  defaultEnabled?: PluginId[];
  children: React.ReactNode;
}

function makePluginContext(
  registry: PluginRegistry,
  plugin: Plugin,
  accountId: string,
  keyring: Keyring,
  storage: AccountStorage,
  lease: PluginLease
): PluginContext {
  const manifest = plugin.manifest;
  const pluginStorage = storage.plugin(manifest.id);
  const active = () => lease.assertActive();
  const guard = lease.guard;
  const require = (permission: PluginPermission) => {
    if (!manifest.permissions.includes(permission)) {
      throw new Error(`Plugin "${manifest.id}" used ${permission} without declaring it.`);
    }
  };
  const accountChat = () => {
    active();
    const chat = useChatStore.getState();
    if (chat.accountId !== accountId) throw new Error(`Plugin "${manifest.id}" is no longer active.`);
    return chat;
  };

  return {
    manifest,
    storage: {
      async get(key) {
        require('storage');
        return guard(() => pluginStorage.get(key));
      },
      async set(key, value) {
        require('storage');
        await guard(() => pluginStorage.set(key, value));
        notifyLiveViews(manifest.id);
      },
      async remove(key) {
        require('storage');
        await guard(() => pluginStorage.remove(key));
        notifyLiveViews(manifest.id);
      },
    },

    identity: {
      get accountId() {
        active();
        return accountId;
      },
      get capabilities() {
        active();
        return capabilitiesOf(keyring.kind);
      },
      get address() {
        active();
        return keyring.address;
      },
      get participantId() {
        return xmtpSessionFor(accountChat())?.self.participantId ?? '';
      },
      async signMessage(message: string) {
        active();
        require('identity.sign');
        return guard(() => keyring.account.signMessage({ message }));
      },
      account() {
        active();
        require('identity.sign');
        return keyring.account;
      },
      derive(path: string) {
        active();
        require('identity.sign');
        return keyring.derive(path);
      },
      deriveEd25519(path: string) {
        active();
        require('identity.sign');
        return keyring.deriveEd25519(path);
      },
    },

    chat: {
      async startDm(addressOrInboxId) {
        require('chat.send');
        const chat = accountChat();
        const session = xmtpSessionFor(chat);
        if (!session) throw new Error('Not connected to the network yet.');

        const participantId = await session.resolvePeer(addressOrInboxId);
        active();
        if (!participantId) return null;

        const conversation = await chat.startDm(PLUGIN_PROTOCOL, participantId);
        active();
        return conversation.id;
      },
      async startGroup(addressesOrInboxIds, title) {
        require('chat.send');
        const chat = accountChat();
        const session = xmtpSessionFor(chat);
        if (!session) throw new Error('Not connected to the network yet.');

        const resolved = await Promise.all(
          addressesOrInboxIds.map(async (value) => ({
            value,
            participantId: await session.resolvePeer(value),
          }))
        );
        active();

        const reachable = resolved
          .filter((r) => r.participantId)
          .map((r) => r.participantId as string);
        const unreachable = resolved.filter((r) => !r.participantId).map((r) => r.value);

        if (reachable.length === 0) {
          throw new Error('None of those addresses can receive messages yet.');
        }

        const conversation = await chat.startGroup(PLUGIN_PROTOCOL, reachable, title);
        active();
        return { conversationId: conversation.id, unreachable };
      },
      async send(conversationId, content) {
        require('chat.send');
        await guard(() => accountChat().sendMessage(conversationId, content));
      },
      async sendText(conversationId, text) {
        require('chat.send');
        await guard(() => accountChat().sendMessage(conversationId, { kind: 'text', text }));
      },
      async members(conversationId) {
        require('chat.read');
        try {
          const roster = await accountChat().getMembers(conversationId);
          active();
          return roster.map((member) => member.id);
        } catch {
          active();
          return [];
        }
      },

      async sendCustom(conversationId, typeId, data) {
        require('chat.send');
        await guard(() =>
          accountChat().sendMessage(conversationId, { kind: 'custom', typeId, data })
        );
      },
    },

    plugins: {
      list() {
        active();
        require('plugins.manage');
        return registry.list().map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          description: p.manifest.description,
          enabled: registry.isActive(p.manifest.id),
          icon: p.manifest.icon,
        }));
      },
      async setEnabled(id, enabled) {
        active();
        require('plugins.manage');
        await accountRuntime.setPluginEnabled(id, enabled);
        active();
      },
      commands(conversationId) {
        active();
        require('plugins.manage');
        const kind = useChatStore
          .getState()
          .conversations.find((c) => c.id === conversationId)?.kind;
        const scope = conversationScope(conversationId, kind);
        return registry.commandListFor(conversationId, scope).map(({ command, pluginId }) => ({
          name: command.name,
          description: command.description,
          usage: command.usage,
          pluginId,
        }));
      },
      channelOwner(conversationId) {
        active();
        require('plugins.manage');
        return registry.channelOwner(conversationId);
      },
    },

    ui: {
      notify(message, tone = 'info') {
        active();
        toast[tone](message);
      },
      openConversation(conversationId) {
        active();
        router.push(`/chat/${conversationId}`);
      },
      openProfile(conversationId, participantId) {
        active();
        router.push({
          pathname: '/profile/[id]',
          params: participantId
            ? { id: conversationId, member: participantId }
            : { id: conversationId },
        });
      },
      async openExternalUrl(url: string) {
        require('browser.open');
        await guard(() =>
          WebBrowser.openBrowserAsync(url, {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
            enableBarCollapsing: true,
          }).then(() => undefined)
        );
      },
    },
  };
}

export function PluginProvider({ plugins, defaultEnabled, children }: PluginProviderProps) {
  const [registry] = useState(
    () => new PluginRegistry(plugins, { commands: groupCommands, composerActions: groupComposerActions })
  );
  const [enabledIds, setEnabledIds] = useState<PluginId[]>([]);

  const setEnabled = async (id: PluginId, enabled: boolean) => {
    await accountRuntime.setPluginEnabled(id, enabled);
  };

  const handleUri = (url: string) => registry.handleUri(url);

  const value: PluginHostValue = {
    registry,
    enabledIds,
    defaultEnabled: defaultEnabled ?? registry.list().map((plugin) => plugin.manifest.id),
    makeContext: (plugin, accountId, keyring, storage, lease) =>
      makePluginContext(registry, plugin, accountId, keyring, storage, lease),
    onPluginsChanged: setEnabledIds,
    setEnabled,
    handleUri,
  };

  return <PluginHostContext value={value}>{children}</PluginHostContext>;
}
