import { useEffect } from 'react';
import { create } from 'zustand';

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
import { sameValue } from '@/lib/same-value';

interface KnownNames extends ResolvedParticipants {
  accountId: string | null;
  own: Record<ParticipantId, string>;
}

const NONE: KnownNames = { accountId: null, names: {}, addresses: {}, own: {} };

const useKnownNames = create<KnownNames>(() => NONE);

function remember(accountId: string, found: Partial<Omit<KnownNames, 'accountId'>>): void {
  useKnownNames.setState((known) => {
    const base = known.accountId === accountId ? known : { ...NONE, accountId };
    const merge = (next: Record<string, string> | undefined, previous: Record<string, string>) =>
      next && Object.entries(next).some(([id, value]) => previous[id] !== value)
        ? { ...previous, ...next }
        : previous;
    const next = {
      accountId,
      names: merge(found.names, base.names),
      addresses: merge(found.addresses, base.addresses),
      own: found.own && !sameValue(found.own, base.own) ? found.own : base.own,
    };
    return next.names === base.names && next.addresses === base.addresses && next.own === base.own
      ? base
      : next;
  });
}

export function useDisplayNames(participants: DisplayParticipant[]) {
  const accountId = useChatStore((s) => s.accountId);
  const sessions = useChatStore((s) => s.sessions);
  const known = useKnownNames((s) => (s.accountId === accountId ? s : NONE));
  const registry = usePluginRegistry();
  const pluginVersions = useLiveViews((s) => s.versions);

  useEffect(() => {
    if (!registry || !accountId) return;
    let cancelled = false;
    registry
      .participantNames()
      .then((own) => {
        if (!cancelled) remember(accountId, { own });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [registry, accountId, pluginVersions]);

  const key = [...new Set(participants.map((p) => `${p.protocol ?? ''}:${p.id}`))].sort().join(',');

  useEffect(() => {
    if (!key || !accountId) return;
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
      void resolveParticipants(protocol, ids).then((found) => {
        if (!cancelled) remember(accountId, found);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [sessions, key, accountId]);

  return {
    nameFor: (id: ParticipantId) => nameFrom(id, known, known.own),
    addressFor(id: ParticipantId): string | undefined {
      return known.addresses[id];
    },
  };
}

export function usePeers(conversations: Conversation[]): DisplayParticipant[] {
  const sessions = useChatStore((s) => s.sessions);
  return conversations.flatMap((c) =>
    c.kind === 'dm' ? conversationPeers(c, selfIdFor({ sessions }, c.protocol)) : []
  );
}
