import { isLocalConversation } from './bots';
import type { ChatPrefsMap } from './chat-prefs';
import { isUnread } from './unread';
import type { Conversation, ConversationId } from './types';

export type FolderId = 'all' | 'unread' | 'direct' | 'groups' | 'bots' | `protocol:${string}`;

export interface Folder {
  id: FolderId;
  label: string;
}

export interface FolderContext {
  prefs: ChatPrefsMap;
  readAt: Record<ConversationId, number>;
}

export function matchesFolder(
  conversation: Conversation,
  folder: FolderId,
  context: FolderContext
): boolean {
  switch (folder) {
    case 'all':
      return true;
    case 'unread':
      return !context.prefs[conversation.id]?.muted && isUnread(conversation, context.readAt);
    case 'direct':
      return conversation.kind === 'dm' && !isLocalConversation(conversation.id);
    case 'groups':
      return conversation.kind === 'group';
    case 'bots':
      return isLocalConversation(conversation.id);
    default: {
      const protocol = folder.slice('protocol:'.length);
      return conversation.protocol === protocol;
    }
  }
}

export function availableFolders(conversations: Conversation[], context: FolderContext): Folder[] {
  const folders: Folder[] = [{ id: 'all', label: 'All' }];

  const has = (id: FolderId) => conversations.some((c) => matchesFolder(c, id, context));

  if (has('unread')) folders.push({ id: 'unread', label: 'Unread' });
  if (has('direct')) folders.push({ id: 'direct', label: 'Direct' });
  if (has('groups')) folders.push({ id: 'groups', label: 'Groups' });
  if (has('bots')) folders.push({ id: 'bots', label: 'Bots' });

  const protocols = [
    ...new Set(
      conversations.map((c) => c.protocol).filter((p): p is string => Boolean(p) && p !== 'local')
    ),
  ].sort();

  if (protocols.length > 1) {
    for (const protocol of protocols) {
      folders.push({ id: `protocol:${protocol}`, label: protocol.toUpperCase() });
    }
  }

  return folders;
}

export function countInFolder(
  conversations: Conversation[],
  folder: FolderId,
  context: FolderContext
): number {
  return conversations.filter((c) => matchesFolder(c, folder, context)).length;
}
