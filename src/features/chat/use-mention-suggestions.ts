import { useEffect, useState } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import type { MentionCandidate } from '@/core/messaging/protocol';
import { mentionLink } from '@/core/messaging/mentions';
import type { ConversationId } from '@/core/messaging/types';

const MENTION = /(?:^|\s)@([^\s@]*)$/;

export function useMentionSuggestions(
  conversationId: ConversationId,
  value: string,
  enabled: boolean
) {
  const mentionCandidates = useChatStore((s) => s.mentionCandidates);
  const [found, setFound] = useState<MentionCandidate[]>([]);
  const prefix = enabled ? (MENTION.exec(value)?.[1] ?? null) : null;

  useEffect(() => {
    if (prefix === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      mentionCandidates(conversationId, prefix)
        .then((people) => !cancelled && setFound(people))
        .catch(() => !cancelled && setFound([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, mentionCandidates, prefix]);

  const needle = prefix?.toLowerCase();
  const matches =
    needle === undefined
      ? []
      : found.filter(
          (person) =>
            person.handle?.toLowerCase().includes(needle) ||
            person.name.toLowerCase().includes(needle)
        );

  return {
    matches,
    apply: (person: MentionCandidate) => applyMention(value, person),
  };
}

export function applyMention(value: string, person: MentionCandidate): string {
  return value.replace(/@[^\s@]*$/, `${person.handle ?? mentionLink(person.name, person.id)} `);
}
