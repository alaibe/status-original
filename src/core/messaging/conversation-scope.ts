import { isLocalConversation } from './bots';
import type { ConversationId } from './types';

export type ConversationScope = 'dm' | 'group' | 'channel';

export function conversationScope(
  id: ConversationId,
  kind?: 'dm' | 'group'
): ConversationScope {
  if (isLocalConversation(id)) return 'channel';
  return kind === 'group' ? 'group' : 'dm';
}

export function inScope(
  showIn: readonly ConversationScope[] | undefined,
  scope: ConversationScope
): boolean {
  return showIn === undefined || showIn.includes(scope);
}
