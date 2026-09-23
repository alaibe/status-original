import { useState } from 'react';
import { View } from 'react-native';

import { Avatar, Button, Card, Eyebrow, Field, Text } from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ProtocolId } from '@/core/messaging/namespace';
import type { PublicChatPreview } from '@/core/messaging/protocol';
import type { PublicChatsCopy } from '@/core/messaging/registry';
import { openChatFromSheet } from '@/features/navigation/open';

export function JoinPublicChat({
  protocol,
  copy,
}: {
  protocol: ProtocolId;
  copy: PublicChatsCopy;
}) {
  const previewPublicChat = useChatStore((s) => s.previewPublicChat);
  const joinPublicChat = useChatStore((s) => s.joinPublicChat);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<PublicChatPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewPublicChat(protocol, input));
    } catch (failure) {
      setError(errorMessage(failure, 'Could not preview that chat'));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await joinPublicChat(protocol, preview.id);
      if (conversation) openChatFromSheet(conversation.id);
      else {
        setRequestSent(true);
        setPreview(null);
      }
    } catch (failure) {
      setError(errorMessage(failure, 'Could not join that chat'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <Eyebrow>{copy.title}</Eyebrow>
      <Text variant="caption">{copy.hint}</Text>
      <View className="flex-row items-end gap-2">
        <Field
          label="Group or channel"
          placeholder={copy.placeholder}
          containerClassName="flex-1"
          value={input}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => {
            setInput(value);
            setPreview(null);
            setError(null);
            setRequestSent(false);
          }}
          onSubmitEditing={lookup}
        />
        <Button
          label="Preview"
          size="sm"
          disabled={!input.trim() || busy}
          loading={busy && !preview}
          onPress={lookup}
        />
      </View>
      {preview ? (
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <Avatar seed={preview.id} label={preview.title} size="md" image={preview.avatarUri} />
            <View className="min-w-0 flex-1">
              <Text className="font-semibold" numberOfLines={1}>
                {preview.title}
              </Text>
              <Text variant="caption">
                {preview.kind === 'channel'
                  ? 'Channel'
                  : preview.kind === 'room'
                    ? 'Room'
                    : 'Group'}
                {preview.memberCount
                  ? ` · ${preview.memberCount} ${preview.kind === 'channel' ? 'subscribers' : 'members'}`
                  : ''}
              </Text>
            </View>
          </View>
          {preview.description ? <Text variant="footnote">{preview.description}</Text> : null}
          <Button
            label={
              preview.joined
                ? 'Open chat'
                : preview.requiresApproval
                  ? 'Request to join'
                  : 'Join chat'
            }
            loading={busy}
            disabled={Boolean(preview.joinUnavailableReason)}
            onPress={join}
          />
          {preview.joinUnavailableReason ? (
            <Text variant="caption">{preview.joinUnavailableReason}</Text>
          ) : null}
        </Card>
      ) : null}
      {requestSent ? (
        <Text variant="caption">Join request sent. An administrator needs to approve it.</Text>
      ) : null}
      {error ? (
        <Text variant="caption" className="text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
