import type { AccountRuntime } from '@/core/app/account-runtime';
import type { AppearanceState } from '@/core/app/appearance';
import type { IdentityState } from '@/core/identity/identity-store';
import type { ChatState } from '@/core/messaging/chat-store';
import type { XmtpCapabilities } from '@/core/messaging/protocol';
import type { PluginHostValue } from '@/core/plugins/host';

import type { CommandPath } from './commands';

type Actions<S> = {
  [K in keyof S]-?: NonNullable<S[K]> extends (...args: never[]) => unknown ? K : never;
}[keyof S];

/**
 * Where each thing the app can do lives on the command line. A new store
 * action fails typecheck until it is given a command here, or a reason why it
 * has none: `internal` for plumbing no one triggers, `app:` for what needs the
 * window or a device in hand.
 */
type Covered = CommandPath | 'internal' | `app: ${string}`;

export const CHAT_STORE: Record<Actions<ChatState>, Covered> = {
  registerBots: 'internal',
  postLocalMessage: 'internal',
  postPrivateMessage: 'internal',
  refreshConversations: 'networks sync',
  loadMessages: 'read',
  loadOlderMessages: 'read',
  searchMessages: 'search',
  sendMessage: 'send',
  resolvePeer: 'resolve',
  startDm: 'new',
  startGroup: 'group create',
  previewPublicChat: 'join',
  joinPublicChat: 'join',
  createInviteLink: 'group invite-link',
  getJoinRequests: 'group requests',
  processJoinRequest: 'group approve',
  sync: 'networks sync',
  syncProtocol: 'networks sync',
  getMembers: 'group members',
  mentionCandidates: 'internal',
  getGroupInfo: 'chat',
  setSlowModeDelay: 'group slowmode',
  addMembers: 'group add',
  removeMembers: 'group remove',
  banMember: 'group ban',
  setMemberMuted: 'group mute',
  renameGroup: 'group rename',
  leaveGroup: 'group leave',
  react: 'react',
  markRead: 'mark-read',
  fetchMedia: 'download',
  setTyping: 'internal',
  watchPresence: 'chat',
  markUnread: 'mark-unread',
  setConsent: 'accept',
  setChatPref: 'pin',
  setDraft: 'draft',
  ingestMessage: 'internal',
  ingestConversation: 'internal',
  ingestConversations: 'internal',
  replacePending: 'internal',
  retryMessage: 'retry',
  editMessage: 'edit',
  deleteMessage: 'delete',
  votePoll: 'poll vote',
  createPoll: 'poll create',
  listPinnedMessages: 'pins',
  setMessagePinned: 'pin-message',
  removeMessages: 'internal',
};

export const IDENTITY_STORE: Record<Actions<IdentityState>, Covered> = {
  restore: 'internal',
  retryUnlock: 'app: the lock screen asks the system to unlock the keys',
  adoptIdentity: 'accounts import',
  addHardwareAccount: 'app: pairing needs the hardware wallet and its screen',
  selectAccount: 'accounts use',
  renameAccount: 'accounts rename',
  removeErasedAccount: 'accounts erase',
};

export const APPEARANCE_STORE: Record<Actions<AppearanceState>, Covered> = {
  hydrate: 'internal',
  clear: 'internal',
  setTheme: 'settings set',
  setWallpaper: 'settings set',
  setReadReceipts: 'settings set',
  setTypingIndicators: 'settings set',
  setLinkPreviews: 'settings set',
};

export const ACCOUNT_RUNTIME: Record<Actions<AccountRuntime>, Covered> = {
  synchronize: 'internal',
  restart: 'internal',
  disconnect: 'internal',
  setPluginEnabled: 'plugins enable',
  updateProtocolConfig: 'networks config',
  erase: 'accounts erase',
  runningBotIds: 'internal',
  wasProactive: 'internal',
};

export const XMTP: Record<Actions<XmtpCapabilities>, Covered> = {
  eraseLocalDatabase: 'internal',
  listInstallations: 'devices',
  revokeInstallations: 'devices revoke',
};

export const PLUGIN_HOST: Record<Actions<PluginHostValue>, Covered> = {
  makeContext: 'internal',
  onPluginsChanged: 'internal',
  setEnabled: 'plugins enable',
  handleUri: 'link',
};
