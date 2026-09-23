import { formatTimestamp } from '@/core/messaging/preview';
import type { Conversation } from '@/core/messaging/types';
import { protocolSubtitle } from '@/features/protocols/presentation';

export function headerSubtitle(conversation: Conversation | undefined): string {
  if (conversation?.typing) return 'typing…';
  if (conversation?.kind === 'dm' && conversation.online) return 'online';
  if (conversation?.kind === 'dm' && conversation.lastSeenAt)
    return `last seen ${formatTimestamp(conversation.lastSeenAt)}`;
  const requests = conversation?.pendingJoinRequests;
  if (requests) return requests === 1 ? '1 join request' : `${requests} join requests`;
  const network = protocolSubtitle(conversation?.protocol);
  if (conversation?.kind === 'channel') return `Channel · ${network}`;
  if (conversation?.kind === 'group')
    return `${conversation.memberIds.length} members · ${network}`;
  return network;
}
