import { useEffect, useState } from 'react';

import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import {
  conversationPeers,
  nameFrom,
  resolveParticipants,
  type DisplayParticipant,
  type ResolvedParticipants,
} from '@/core/messaging/display-names';
import type { Conversation, ParticipantId } from '@/core/messaging/types';
import { usePluginRegistry } from '@/core/plugins/host';
import { useLiveViews } from '@/core/plugins/live';

export function useDisplayNames(participants: DisplayParticipant[]) {
  const sessions = useChatStore((s) => s.sessions);
  const [resolved, setResolved] = useState<ResolvedParticipants>({ names: {}, addresses: {} });
  const [ownNames, setOwnNames] = useState<Record<ParticipantId, string>>({});
  const registry = usePluginRegistry();
  const pluginVersions = useLiveViews((s) => s.versions);

  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    registry
      .participantNames()
      .then((names) => {
        if (!cancelled) setOwnNames(names);
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
      if (!sessions[protocol]) continue;
      void resolveParticipants(protocol, ids).then(({ names, addresses }) => {
        if (cancelled) return;
        setResolved((prev) => ({
          names: { ...prev.names, ...names },
          addresses: { ...prev.addresses, ...addresses },
        }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [sessions, key]);

  return {
    nameFor: (id: ParticipantId) => nameFrom(id, resolved, ownNames),
    addressFor(id: ParticipantId): string | undefined {
      return resolved.addresses[id];
    },
  };
}

export function usePeers(conversations: Conversation[]): DisplayParticipant[] {
  const sessions = useChatStore((s) => s.sessions);
  return conversations.flatMap((c) => conversationPeers(c, selfIdFor({ sessions }, c.protocol)));
}
