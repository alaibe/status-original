import { isLocalConversation } from './bots';
import type { ConversationId, ConversationKind } from './types';

export type ConversationScope = 'dm' | 'group' | 'channel';

export function conversationScope(id: ConversationId, kind?: ConversationKind): ConversationScope {
  if (isLocalConversation(id)) return 'channel';
  return kind ?? 'dm';
}

export function inScope(
  showIn: readonly ConversationScope[] | undefined,
  scope: ConversationScope
): boolean {
  return showIn === undefined || showIn.includes(scope);
}
