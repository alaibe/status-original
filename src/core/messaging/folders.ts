import { isLocalConversation } from './bots';
import type { ChatPrefsMap } from './chat-prefs';
import { LOCAL_PROTOCOL } from './namespace';
import { isUnread } from './unread';
import type { Conversation, ConversationId } from './types';

/** A row in the inbox that opens onto a list of its own, as Telegram's Archived Chats does. */
export type Directory = 'archive' | `network:${string}`;

export type ChatFilter = 'all' | 'unread' | 'direct' | 'groups';

export interface FolderContext {
  prefs: ChatPrefsMap;
  readAt: Record<ConversationId, number>;
}

export type InboxRow =
  | { kind: 'chat'; conversation: Conversation }
  | { kind: 'directory'; directory: Directory; latest: Conversation; chats: Conversation[] };

/** The network a chat lives on: the bridged one when there is a bridge, else its protocol. */
export function networkOf(conversation: Conversation): string | undefined {
  if (!conversation.protocol || conversation.protocol === LOCAL_PROTOCOL) return undefined;
  return conversation.network ?? conversation.protocol;
}

/** Muting says "stop drawing my attention", so a muted chat never counts as unread here. */
export function isUnreadHere(conversation: Conversation, context: FolderContext): boolean {
  return !context.prefs[conversation.id]?.muted && isUnread(conversation, context.readAt);
}

export function matchesFilter(
  conversation: Conversation,
  filter: ChatFilter,
  context: FolderContext
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unread':
      return isUnreadHere(conversation, context);
    case 'direct':
      return conversation.kind === 'dm' && !isLocalConversation(conversation.id);
    case 'groups':
      return conversation.kind === 'group';
  }
}

export function inDirectory(
  conversation: Conversation,
  directory: Directory,
  context: FolderContext
): boolean {
  const archived = Boolean(context.prefs[conversation.id]?.archived);
  if (directory === 'archive') return archived;
  return !archived && networkOf(conversation) === directory.slice('network:'.length);
}

/**
 * The inbox: chats on your own networks one by one, chats elsewhere folded
 * into one row per network where its latest chat would sit, and Archive on
 * top. A pinned chat stays out of its folder, since pinning asks to see it.
 */
export function inboxRows(
  ordered: Conversation[],
  include: (conversation: Conversation) => boolean,
  folded: (network: string) => boolean,
  context: FolderContext
): InboxRow[] {
  const rows: InboxRow[] = [];
  const directories = new Map<string, Extract<InboxRow, { kind: 'directory' }>>();

  const archived = ordered.filter((c) => context.prefs[c.id]?.archived && include(c));
  if (archived.length > 0) {
    rows.push({ kind: 'directory', directory: 'archive', latest: archived[0], chats: archived });
  }

  for (const conversation of ordered) {
    if (context.prefs[conversation.id]?.archived || !include(conversation)) continue;
    const network = networkOf(conversation);
    if (!network || !folded(network) || context.prefs[conversation.id]?.pinned) {
      rows.push({ kind: 'chat', conversation });
      continue;
    }
    const existing = directories.get(network);
    if (existing) {
      existing.chats.push(conversation);
      continue;
    }
    const row: Extract<InboxRow, { kind: 'directory' }> = {
      kind: 'directory',
      directory: `network:${network}`,
      latest: conversation,
      chats: [conversation],
    };
    directories.set(network, row);
    rows.push(row);
  }
  return rows;
}
