import type { Capability } from '../messaging/capability';
import type { ComponentType } from 'react';
import type { Address, Hex, LocalAccount } from 'viem';

import type { DerivedKey } from '../identity/keyring';
import type { Ed25519Key } from '../identity/slip10';
import type { AccountCapabilities } from '../identity/account-kind';

import type { IconName } from '@/design';
import type { ConversationScope } from '../messaging/conversation-scope';

import type { Bot } from '../messaging/bots';
import type {
  ChatMessage,
  ConversationId,
  MessageContent,
  ParticipantId,
  WidgetContent,
} from '../messaging/types';

export type { Bot, BotContext, BotDisposer } from '../messaging/bots';
export { poll } from '../messaging/bots';

export type PluginId = string;

export type PluginPermission =
  | 'identity.read'
  | 'identity.sign'
  | 'chat.read'
  | 'chat.send'
  | 'network'
  | 'storage'
  | 'browser.open'
  | 'plugins.manage';

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  'identity.read': 'See your address and inbox id',
  'identity.sign': 'Ask you to sign messages and transactions',
  'chat.read': 'Read messages in your conversations',
  'chat.send': 'Send messages on your behalf',
  network: 'Make network requests',
  storage: 'Store data on this device',
  'browser.open': 'Open links in your browser',
  'plugins.manage': 'Turn other plugins on and off',
};

export interface PluginManifest {
  id: PluginId;
  name: string;
  description: string;
  version: string;
  icon: IconName;
  permissions: PluginPermission[];
  requiresSessionRestart?: boolean;
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PluginIdentityApi {
  accountId: string | null;
  capabilities: AccountCapabilities;
  address: Address;
  participantId: string;
  signMessage(message: string): Promise<Hex>;
  account(): LocalAccount;
  derive(path: string): DerivedKey;
  deriveEd25519(path: string): Ed25519Key;
}

export interface PluginChatApi {
  startDm(addressOrInboxId: string): Promise<ConversationId | null>;
  startGroup(
    addressesOrInboxIds: string[],
    title: string
  ): Promise<{ conversationId: ConversationId; unreachable: string[] }>;
  send(conversationId: ConversationId, content: MessageContent): Promise<void>;
  sendText(conversationId: ConversationId, text: string): Promise<void>;
  sendCustom(conversationId: ConversationId, typeId: string, data: unknown): Promise<void>;
  members(conversationId: ConversationId): Promise<ParticipantId[]>;
}

export interface PluginUiApi {
  notify(message: string, tone?: 'info' | 'success' | 'error'): void;
  /**
   * Hands the URL to the system browser. An in-app browser would lose the page
   * the moment the user came back here to approve a WalletConnect request.
   */
  openExternalUrl(url: string): Promise<void>;
  openConversation(conversationId: ConversationId): void;
  openProfile(conversationId: ConversationId, participantId?: ParticipantId): void;
}

export interface PluginSummary {
  id: PluginId;
  name: string;
  description: string;
  enabled: boolean;
  icon?: IconName;
}

export interface PluginManagementApi {
  list(): PluginSummary[];
  setEnabled(id: PluginId, enabled: boolean): Promise<void>;
  commands(
    conversationId: ConversationId
  ): { name: string; description: string; usage: string; pluginId: PluginId }[];
  channelOwner(conversationId: ConversationId): PluginId | undefined;
}

export interface PluginContext {
  manifest: PluginManifest;
  storage: PluginStorage;
  identity: PluginIdentityApi;
  chat: PluginChatApi;
  ui: PluginUiApi;
  plugins: PluginManagementApi;
}

export interface PluginLease {
  assertActive(): void;
  guard<T>(run: () => Promise<T>): Promise<T>;
}

export interface CommandInvocation {
  rest: string;
  respond(content: MessageContent | string): Promise<void>;
  args: string[];
  conversationId: ConversationId;
  context: PluginContext;
}

export type CommandResult =
  | { type: 'handled' }
  | { type: 'setComposer'; text: string }
  | { type: 'notice'; message: string; tone?: 'info' | 'success' }
  | { type: 'error'; message: string };

export interface SlashCommand {
  name: string;
  /** Offered only in chats whose network can do this. */
  requires?: Capability;
  /** Posts a plugin content type, which only some networks carry. */
  sendsCustom?: boolean;
  aliases?: string[];
  description: string;
  usage: string;
  global?: boolean;
  showIn?: readonly ConversationScope[];
  hidden?: boolean;
  run(invocation: CommandInvocation): Promise<CommandResult>;
}

export interface MessageRendererProps<T = unknown> {
  data: T;
  message: ChatMessage;
  fromMe: boolean;
  context: PluginContext;
  onCommand?: (command: string) => void;
}

export interface PluginContentType<T = any> {
  typeId: string;
  fallback: (data: T) => string;
  render: ComponentType<MessageRendererProps<T>>;
}

export interface ComposerAction {
  id: string;
  label: string;
  icon: IconName;
  command: string;
  showIn?: readonly ConversationScope[];
  global?: boolean;
}

export interface PluginOverlay {
  id: string;
  component: ComponentType;
}

export interface UriHandler {
  schemes: string[];
  handle(url: string, context: PluginContext): Promise<boolean>;
}

export type PluginView = (args?: string[]) => Promise<WidgetContent>;

export interface PluginContribution {
  commands?: SlashCommand[];
  views?: Record<string, PluginView>;
  bots?: Bot[];
  contentTypes?: PluginContentType<any>[];
  composerActions?: ComposerAction[];
  overlays?: PluginOverlay[];
  uriHandlers?: UriHandler[];
  /** Names you gave participants, such as bots you added. They win over names from the network. */
  names?(): Promise<Record<ParticipantId, string>>;
  start?(): Promise<(() => void) | void>;
}

export interface Plugin {
  manifest: PluginManifest;
  setup(context: PluginContext): PluginContribution;
}

export interface ActivePlugin {
  plugin: Plugin;
  contribution: PluginContribution;
  context: PluginContext;
  revoke?: () => void;
  dispose?: () => void;
}
