import { useEffect, useState } from 'react';

import { shortAddress } from '@/core/identity/keyring';
import { isLocalConversation } from '@/core/messaging/bots';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { Conversation, ParticipantId } from '@/core/messaging/types';
import { usePluginRegistry } from '@/core/plugins/host';
import { useLiveViews } from '@/core/plugins/live';

export interface DisplayParticipant {
  id: ParticipantId;
  protocol?: string;
}

export function useDisplayNames(participants: DisplayParticipant[]) {
  const sessions = useChatStore((s) => s.sessions);
  const [addresses, setAddresses] = useState<Record<ParticipantId, string>>({});
  const [names, setNames] = useState<Record<ParticipantId, string>>({});
  const [ownNames, setOwnNames] = useState<Record<ParticipantId, string>>({});
  const registry = usePluginRegistry();
  const pluginVersions = useLiveViews((s) => s.versions);

  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    registry
      .participantNames()
      .then((resolved) => {
        if (!cancelled) setOwnNames(resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [registry, pluginVersions]);

  const key = [...new Set(participants.map((p) => `${p.protocol ?? ''}:${p.id}`))].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    const byProtocol = new Map<string, ParticipantId[]>();
    for (const entry of key.split(',')) {
      const at = entry.indexOf(':');
      const protocol = entry.slice(0, at);
      const id = entry.slice(at + 1);
      if (!protocol || !id) continue;
      byProtocol.set(protocol, [...(byProtocol.get(protocol) ?? []), id]);
    }

    for (const [protocol, ids] of byProtocol) {
      const session = sessions[protocol];
      if (!session) continue;

      session
        .resolveAddresses(ids)
        .then((resolved) => {
          if (!cancelled) setAddresses((prev) => ({ ...prev, ...resolved }));
        })
        .catch(() => {});
      session
        .resolveNames?.(ids)
        .then((resolved) => {
          if (!cancelled) setNames((prev) => ({ ...prev, ...resolved }));
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [sessions, key]);

  return {
    nameFor(id: ParticipantId): string {
      const name = ownNames[id] ?? names[id];
      if (name) return name;
      const address = addresses[id];
      return address ? shortAddress(address) : shortAddress(id, 6, 4);
    },
    addressFor(id: ParticipantId): string | undefined {
      return addresses[id];
    },
  };
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

/** Everyone in the conversation but us, shaped for `useDisplayNames`. */
export function conversationPeers(
  conversation: Conversation,
  selfId: ParticipantId
): DisplayParticipant[] {
  return conversation.memberIds
    .filter((id) => id !== selfId)
    .map((id) => ({ id, protocol: conversation.protocol }));
}

export function usePeers(conversations: Conversation[]): DisplayParticipant[] {
  const sessions = useChatStore((s) => s.sessions);
  return conversations.flatMap((c) => conversationPeers(c, selfIdFor({ sessions }, c.protocol)));
}
