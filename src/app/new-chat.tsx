import { useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, type TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  Avatar,
  Badge,
  Button,
  Eyebrow,
  Field,
  Icon,
  IconButton,
  Pressable,
  Screen,
  springLayout,
  Text,
  useThemeColors,
} from '@/design';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import { useDisplayNames } from '@/features/chat/use-display-names';
import { peersOf } from '@/features/contacts/peers';
import type { ProtocolId } from '@/core/messaging/namespace';
import { transportProtocols } from '@/protocols';
import { useBack } from '@/features/navigation/use-back';
import { openChatFromSheet } from '@/features/navigation/open';
import { toneFor } from '@/features/protocols/presentation';
import { errorMessage } from '@/core/errors';
import { JoinPublicChat } from '@/features/chat/join-public-chat';
import { supports } from '@/core/messaging/capability';

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

export default function NewChatScreen() {
  const colors = useThemeColors();
  const goBack = useBack('/chats');

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
          title.trim() || defaultGroupName(recipients)
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

  return (
    <Screen className="px-gutter" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between pb-4 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={goBack}
          className="h-9 w-9 items-center justify-center rounded-pill bg-surface-sunken">
          <Icon name="close" size={20} color={colors['content-muted']} />
        </Pressable>
        <Text className="font-semibold">{isGroup ? 'New group' : 'New message'}</Text>
        <View className="h-9 w-9" />
      </View>

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-between">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4">
          {available.length > 1 ? (
            <View className="gap-2">
              <Eyebrow>Protocol</Eyebrow>
              <View className="flex-row flex-wrap gap-2">
                {available.map((option) => (
                  <Pressable
                    key={option.id}
                    testID={`new-chat-protocol-${option.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.id === active }}
                    onPress={() => chooseProtocol(option.id)}
                    className={
                      option.id === active
                        ? 'rounded-pill border border-brand bg-brand-soft px-3 py-2'
                        : 'rounded-pill border border-line bg-surface px-3 py-2'
                    }>
                    <Text
                      className={
                        option.id === active ? 'text-footnote text-brand' : 'text-footnote'
                      }>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {descriptor ? (
                <View className="flex-row items-start gap-2">
                  <Badge
                    label={descriptor.meta.properties.endToEndEncrypted ? 'Encrypted' : 'Not E2EE'}
                    tone={toneFor(descriptor.meta)}
                  />
                  <Text variant="caption" className="flex-1">
                    {descriptor.meta.trustModel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text variant="bodyMuted">
            {descriptor
              ? `${descriptor.recipient.hint} Add more than one to make it a group.`
              : 'Connecting…'}
          </Text>

          {descriptor?.publicChats && supports(sessions[active], 'previewPublicChat') ? (
            <JoinPublicChat key={active} protocol={active} copy={descriptor.publicChats} />
          ) : null}

          {descriptor ? (
            <View className="gap-1">
              <Eyebrow>
                {known.length > 0
                  ? `People you have talked to on ${descriptor.label}`
                  : `Nobody yet on ${descriptor.label}`}
              </Eyebrow>
              {known.length === 0 ? (
                <Text variant="caption">
                  {`Paste ${descriptor.recipient.noun} below to start the first one. People you talk to on another protocol are listed under that protocol, because an id only means something to the network that made it.`}
                </Text>
              ) : null}
              {known.map((entry) =>
                entry.kind === 'header' ? (
                  <Text key={`h-${entry.letter}`} variant="micro" className="pl-1 pt-2">
                    {entry.letter}
                  </Text>
                ) : (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selectedIds.has(entry.id) }}
                    accessibilityLabel={entry.name}
                    onPress={() => toggleRecipient(entry.id, entry.name)}
                    className="min-h-tap flex-row items-center gap-3 py-1.5">
                    <Avatar seed={entry.name} size="md" />
                    <Text className="flex-1 font-medium" numberOfLines={1}>
                      {entry.name}
                    </Text>
                    <Icon
                      name={selectedIds.has(entry.id) ? 'checkmark-circle' : 'add-circle-outline'}
                      size={20}
                      color={selectedIds.has(entry.id) ? colors.brand : colors['content-subtle']}
                    />
                  </Pressable>
                )
              )}
            </View>
          ) : null}

          <View className="flex-row items-end gap-2">
            <Field
              testID="new-chat-input"
              containerClassName="flex-1"
              label={descriptor?.recipient.label ?? 'Recipient'}
              placeholder={descriptor?.recipient.placeholder}
              ref={draftRef}
              onChangeText={(t) => {
                setDraft(t);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={addRecipient}
            />
            <IconButton
              testID="new-chat-add"
              icon="add"
              label="Add recipient"
              tone="brand"
              onPress={addRecipient}
              disabled={draft.trim().length < 3 || busy}
              className="mb-0.5"
            />
          </View>

          {error ? (
            <Text variant="caption" className="text-danger">
              {error}
            </Text>
          ) : null}

          {recipients.length > 0 ? (
            <Animated.View layout={springLayout()} className="gap-2">
              <Eyebrow>{`${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`}</Eyebrow>

              {recipients.map((r) => (
                <View
                  key={r.participantId}
                  className="flex-row items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5">
                  <Avatar seed={r.participantId} size="sm" />
                  <Text numberOfLines={1} className="flex-1 text-footnote">
                    {r.input}
                  </Text>
                  <IconButton
                    icon="close"
                    label={`Remove ${r.input}`}
                    size={18}
                    onPress={() =>
                      setRecipients((c) => c.filter((x) => x.participantId !== r.participantId))
                    }
                  />
                </View>
              ))}
            </Animated.View>
          ) : null}

          {isGroup ? (
            <Animated.View layout={springLayout()} className="gap-2">
              <Field
                testID="new-chat-title"
                label="Group name"
                placeholder={defaultGroupName(recipients)}
                onChangeText={setTitle}
                returnKeyType="done"
              />
              {descriptor ? (
                <View className="flex-row items-start gap-2">
                  <Badge
                    label={GROUP_BADGE[descriptor.meta.properties.groupModel].label}
                    tone={GROUP_BADGE[descriptor.meta.properties.groupModel].tone}
                  />
                  <Text variant="caption" className="flex-1">
                    {GROUP_BADGE[descriptor.meta.properties.groupModel].detail}
                  </Text>
                </View>
              ) : null}
            </Animated.View>
          ) : null}
        </ScrollView>

        <View className="gap-2 pb-4 pt-2">
          <Button
            testID="new-chat-start"
            label={
              isGroup
                ? `Create group of ${recipients.length + 1}`
                : existingDm
                  ? 'Open chat'
                  : 'Start chatting'
            }
            size="md"
            fullWidth
            loading={busy}
            disabled={recipients.length === 0 || !active}
            onPress={start}
          />
          <Button label="Cancel" tone="ghost" fullWidth onPress={goBack} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const GROUP_BADGE = {
  enforced: {
    label: 'Enforced roster',
    tone: 'success' as const,
    detail:
      'Membership changes are themselves encrypted messages, so everyone converges on the same roster.',
  },
  'recipient-set': {
    label: 'No roster',
    tone: 'warning' as const,
    detail:
      'The group is whoever a message is addressed to. Nobody can be added or removed afterwards, and leaving is only local to your device.',
  },
  topic: {
    label: 'Open topic',
    tone: 'warning' as const,
    detail:
      'Anyone who learns the topic can post to it. Messages are still encrypted to the people you list, but membership is not enforced.',
  },
};

function defaultGroupName(recipients: Recipient[]): string {
  const names = recipients.slice(0, 2).map((r) => r.input.split('.')[0].slice(0, 10));
  const rest = recipients.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ');
}
