import { shortAddress } from '@/core/identity/keyring';

import { isLocalConversation } from './bots';
import { useChatStore } from './chat-store';
import type { Conversation, ParticipantId } from './types';

export interface DisplayParticipant {
  id: ParticipantId;
  protocol?: string;
}

export interface ResolvedParticipants {
  names: Record<ParticipantId, string>;
  addresses: Record<ParticipantId, string>;
}

/** What a network knows about these participants; a lookup that fails leaves them out. */
export async function resolveParticipants(
  protocol: string | null | undefined,
  ids: ParticipantId[]
): Promise<ResolvedParticipants> {
  const session = protocol ? useChatStore.getState().sessions[protocol] : undefined;
  if (!session || ids.length === 0) return { names: {}, addresses: {} };
  const none: Record<ParticipantId, string> = {};
  const [addresses, names] = await Promise.all([
    session.resolveAddresses(ids).catch(() => none),
    session.resolveNames?.(ids).catch(() => none) ?? none,
  ]);
  return { names, addresses };
}

/** `own` are the names you gave people, through a plugin; they win over the network's. */
export function nameFrom(
  id: ParticipantId,
  { names, addresses }: ResolvedParticipants,
  own: Record<ParticipantId, string> = {}
): string {
  return displayName(id, own[id] ?? names[id], addresses[id]);
}

export function displayName(id: ParticipantId, name?: string, address?: string): string {
  return name || (address ? shortAddress(address) : shortAddress(id, 6, 4));
}

export function conversationTitle(
  conversation: Conversation,
  selfId: ParticipantId,
  nameFor: (id: ParticipantId) => string
): string {
  if (conversation.kind !== 'dm') return conversation.title;
  if (isLocalConversation(conversation.id)) return conversation.title;

  const peer = conversation.memberIds.find((id) => id !== selfId) ?? conversation.title;
  return nameFor(peer);
}

/** Everyone in the conversation but us. */
export function conversationPeers(
  conversation: Conversation,
  selfId: ParticipantId
): DisplayParticipant[] {
  return conversation.memberIds
    .filter((id) => id !== selfId)
    .map((id) => ({ id, protocol: conversation.protocol }));
}
