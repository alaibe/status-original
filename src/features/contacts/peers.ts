import { isLocalConversation } from '@/core/messaging/bots';
import type { Conversation, ParticipantId } from '@/core/messaging/types';

export interface Peer {
  id: ParticipantId;
  protocol: Conversation['protocol'];
  conversationId: string;
}

export function peersOf(
  conversations: Conversation[],
  selfFor: (protocol: Conversation['protocol']) => ParticipantId | undefined
): Peer[] {
  // Keyed by protocol *and* id: the same person on Nostr and on XMTP is two
  // identities with two different keys, and merging them would claim a link
  // this app cannot verify.
  const byPeer = new Map<string, Peer>();

  for (const conversation of conversations) {
    if (conversation.kind !== 'dm') continue;
    if (isLocalConversation(conversation.id)) continue;
    if (conversation.consent === 'denied') continue;

    const self = selfFor(conversation.protocol);
    for (const id of conversation.memberIds) {
      if (id === self) continue;
      const key = `${conversation.protocol}:${id}`;
      if (byPeer.has(key)) continue;
      byPeer.set(key, { id, protocol: conversation.protocol, conversationId: conversation.id });
    }
  }

  return [...byPeer.values()];
}
