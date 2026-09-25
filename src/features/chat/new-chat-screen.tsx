import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
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
import { useBack } from '@/features/navigation/use-back';
import { toneFor } from '@/features/protocols/presentation';
import { JoinPublicChat } from '@/features/chat/join-public-chat';
import { supports } from '@/core/messaging/capability';
import { useNewChat } from './use-new-chat';

export function NewChatScreen() {
  const colors = useThemeColors();
  const goBack = useBack('/chats');
  const {
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
  } = useNewChat();

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
              onChangeText={changeDraft}
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
                    onPress={() => removeRecipient(r.participantId)}
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
                placeholder={groupName}
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
