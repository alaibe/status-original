import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { errorMessage } from '@/core/errors';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import type { ProtocolId } from '@/core/messaging/namespace';
import { peersOf } from '@/features/contacts/peers';
import { openChatFromSheet } from '@/features/navigation/open';
import { transportProtocols } from '@/protocols';
import { useDisplayNames } from './use-display-names';

interface Recipient {
  input: string;
  participantId: string;
}

type KnownRow =
  | { kind: 'header'; letter: string }
  | { kind: 'person'; id: string; name: string; conversationId: string };

function groupByInitial(
  people: { id: string; name: string; conversationId: string }[]
): KnownRow[] {
  const out: KnownRow[] = [];
  let letter = '';
  for (const person of people) {
    const initial = person.name.charAt(0).toUpperCase();
    if (initial !== letter) {
      letter = initial;
      out.push({ kind: 'header', letter });
    }
    out.push({
      kind: 'person',
      id: person.id,
      name: person.name,
      conversationId: person.conversationId,
    });
  }
  return out;
}

function defaultGroupName(recipients: Recipient[]): string {
  const names = recipients.slice(0, 2).map((r) => r.input.split('.')[0].slice(0, 10));
  const rest = recipients.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ');
}

export function useNewChat() {
  const sessions = useChatStore((s) => s.sessions);
  const conversations = useChatStore((s) => s.conversations);
  const resolvePeer = useChatStore((s) => s.resolvePeer);
  const startDm = useChatStore((s) => s.startDm);
  const startGroup = useChatStore((s) => s.startGroup);

  const available = transportProtocols().filter((p) => sessions[p.id]);

  const [protocol, setProtocol] = useState<ProtocolId | null>(null);
  const active = protocol ?? available[0]?.id ?? null;
  const descriptor = available.find((p) => p.id === active);

  const [draft, setDraft] = useState('');
  const draftRef = useRef<TextInput>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isGroup = recipients.length > 1;
  const groupName = defaultGroupName(recipients);

  const peers = peersOf(conversations, (p) => selfIdFor({ sessions }, p));
  const { nameFor } = useDisplayNames(peers);
  const known = groupByInitial(
    peers
      .filter((peer) => peer.protocol === active)
      .map((peer) => ({ ...peer, name: nameFor(peer.id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  function chooseProtocol(next: ProtocolId) {
    if (next === active) return;
    setProtocol(next);
    setRecipients([]);
    setError(null);
  }

  function changeDraft(text: string) {
    setDraft(text);
    if (error) setError(null);
  }

  async function addRecipient() {
    const input = draft.trim();
    if (!input) return;

    if (!descriptor) {
      setError('Still connecting to the network. Try again in a moment.');
      return;
    }
    setBusy(true);
    setError(null);
    let participantId: string | null;
    try {
      participantId = await resolvePeer(descriptor.id, input);
    } catch (e) {
      setError(errorMessage(e, 'Could not check that address'));
      setBusy(false);
      return;
    }
    setBusy(false);

    if (!participantId) {
      setError(descriptor.recipient.unreachable(input));
      return;
    }
    if (recipients.some((r) => r.participantId === participantId)) {
      setError(`${input} is already on the list.`);
      return;
    }
    setRecipients((current) => [...current, { input, participantId }]);
    setDraft('');
    draftRef.current?.clear();
  }

  const selectedIds = new Set(recipients.map((r) => r.participantId));

  function toggleRecipient(id: string, name: string) {
    setError(null);
    setRecipients((current) =>
      current.some((r) => r.participantId === id)
        ? current.filter((r) => r.participantId !== id)
        : [...current, { input: name, participantId: id }]
    );
  }

  function removeRecipient(id: string) {
    setRecipients((current) => current.filter((r) => r.participantId !== id));
  }

  const only = recipients.length === 1 ? recipients[0] : null;
  const existingDm = only
    ? (peers.find((p) => p.protocol === active && p.id === only.participantId)?.conversationId ??
      null)
    : null;

  async function start() {
    if (existingDm) {
      openChatFromSheet(existingDm);
      return;
    }

    if (recipients.length === 0 || !active) return;

    setBusy(true);
    setError(null);
    const starting = isGroup
      ? startGroup(
          active,
          recipients.map((r) => r.participantId),
          title.trim() || groupName
        )
      : startDm(active, recipients[0].participantId);
    try {
      const conversation = await starting;
      openChatFromSheet(conversation.id);
    } catch (e) {
      setError(errorMessage(e, 'Could not start that conversation'));
    }
    setBusy(false);
  }

  return {
    sessions,
    available,
    active,
    descriptor,
    draft,
    draftRef,
    recipients,
    groupName,
    error,
    busy,
    isGroup,
    known,
    selectedIds,
    existingDm,
    chooseProtocol,
    changeDraft,
    addRecipient,
    toggleRecipient,
    removeRecipient,
    setTitle,
    start,
  };
}
