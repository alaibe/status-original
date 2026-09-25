import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Avatar,
  BackHeader,
  Badge,
  Card,
  Icon,
  Pressable,
  Screen,
  Text,
  copyText,
  type IconName,
  useThemeColors,
} from '@/design';
import { shortAddress } from '@/core/identity/keyring';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import { errorMessage } from '@/core/errors';
import { conversationPeers, conversationTitle } from '@/core/messaging/display-names';
import { useDisplayNames } from '@/features/chat/use-display-names';
import { useSupports } from '@/features/chat/use-supports';
import { useBack } from '@/features/navigation/use-back';
import { openChatFromProfile } from '@/features/navigation/open';
import { resolveEnsProfile } from '@/lib/evm/ens-profile';
import { protocolSubtitle } from '@/features/protocols/presentation';
import { JoinRequests } from '@/features/chat/join-requests';
import {
  GroupAbout,
  InviteLinks,
  MemberModeration,
  SlowModeSection,
} from '@/features/chat/group-sections';
import { useKeyedLoad } from '@/lib/use-keyed-load';
import { SharedMedia } from './shared-media';

const ensOf = (address: string) => resolveEnsProfile(address as `0x${string}`);

export function ConversationProfile() {
  const { id, member } = useLocalSearchParams<{ id: string; member?: string }>();
  const goBack = useBack('/chats');

  const conversations = useChatStore((s) => s.conversations);
  const sessions = useChatStore((s) => s.sessions);
  const chatPrefs = useChatStore((s) => s.chatPrefs);
  const setChatPref = useChatStore((s) => s.setChatPref);
  const getGroupInfo = useChatStore((s) => s.getGroupInfo);

  const conversation = conversations.find((c) => c.id === id);
  const conversationKind = conversation?.kind;
  const { supports } = useSupports(id);
  const canGetGroupInfo = supports('getGroupInfo');
  const selfId = selfIdFor({ sessions }, conversation?.protocol);
  const peers = conversation ? conversationPeers(conversation, selfId) : [];
  const { nameFor, addressFor } = useDisplayNames(peers);

  const [inviting, setInviting] = useState(false);
  const details = useKeyedLoad(
    conversationKind && conversationKind !== 'dm' && !member && canGetGroupInfo ? id : null,
    getGroupInfo
  );

  const focusId = member ?? (conversationKind === 'dm' ? peers[0]?.id : undefined);
  const peerAddress = focusId ? addressFor?.(focusId) : undefined;
  const shownEns = useKeyedLoad(peerAddress?.startsWith('0x') ? peerAddress : null, ensOf).value;

  if (!conversation) {
    return (
      <Screen className="px-0" edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <BackHeader label="Back" onPress={goBack} />
        <Text variant="footnote" className="px-gutter">
          That conversation is not loaded.
        </Text>
      </Screen>
    );
  }

  const title =
    shownEns?.name ?? (member ? nameFor(member) : conversationTitle(conversation, selfId, nameFor));
  const canRemove =
    Boolean(member) &&
    member !== selfId &&
    conversation.kind === 'group' &&
    (conversation.selfRole === 'owner' || conversation.selfRole === 'admin');
  const muted = Boolean(chatPrefs[id]?.muted);
  const groupInfo = details.value;
  const groupLink = groupInfo?.link;
  const canInvite =
    !member &&
    (conversation.selfRole === 'owner' || conversation.selfRole === 'admin') &&
    supports('createInviteLink');
  return (
    <Screen className="px-0" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader label="Back" onPress={goBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="items-center gap-3 px-gutter pb-5">
          <Avatar
            seed={focusId ?? conversation.id}
            size="xl"
            label={!member && conversation.kind !== 'dm' ? conversation.title : undefined}
            image={groupInfo?.avatarUri ?? shownEns?.avatar ?? undefined}
          />

          <View className="items-center gap-1">
            <Text variant="headline">{title}</Text>
            {shownEns?.name ? (
              <Badge
                label={
                  shownEns.paidUntil
                    ? `ENS · held through ${shownEns.paidUntil.getFullYear()}`
                    : 'ENS name'
                }
                tone="success"
              />
            ) : null}
            <Text variant="micro">{protocolSubtitle(conversation.protocol)}</Text>
            {groupInfo?.memberCount ? (
              <Text variant="caption">
                {groupInfo.memberCount}{' '}
                {conversation.kind === 'channel' ? 'subscribers' : 'members'}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="flex-row justify-center gap-2 px-gutter pb-5">
          <Action
            icon="chatbubble-outline"
            label="Message"
            onPress={() => openChatFromProfile(id)}
          />
          {member ? null : (
            <Action
              icon={muted ? 'volume-high-outline' : 'volume-mute-outline'}
              label={muted ? 'Unmute' : 'Mute'}
              onPress={() => setChatPref(id, { muted: !muted })}
            />
          )}
          {peerAddress || focusId || groupLink ? (
            <Action
              icon="copy-outline"
              label="Copy"
              onPress={() => void copyText(groupLink ?? peerAddress ?? focusId ?? '')}
            />
          ) : null}
          {canInvite ? (
            <Action icon="person-add-outline" label="Invite" onPress={() => setInviting(true)} />
          ) : null}
        </View>

        {peerAddress ? (
          <Card className="mx-gutter mb-5 gap-1">
            <Text variant="caption">Address</Text>
            <Text variant="mono" selectable>
              {shortAddress(peerAddress, 12, 10)}
            </Text>
            {shownEns?.description ? (
              <Text variant="footnote" className="pt-1">
                {shownEns.description}
              </Text>
            ) : null}
            {shownEns?.paidUntil ? (
              <Text variant="micro" className="pt-1">
                {shownEns.name} is registered until{' '}
                {shownEns.paidUntil.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                . Anyone can pick a display name; only the holder can renew this one.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {!member && (conversation.kind === 'group' || conversation.kind === 'channel') ? (
          <GroupAbout
            info={groupInfo}
            error={
              details.error ? errorMessage(details.error, 'Could not load details') : undefined
            }
          />
        ) : null}

        {canInvite ? (
          <InviteLinks conversationId={id} visible={inviting} onClose={() => setInviting(false)} />
        ) : null}

        {canInvite && supports('getJoinRequests') ? (
          <JoinRequests conversationId={id} pending={conversation.pendingJoinRequests} />
        ) : null}

        {!member && groupInfo?.canSetSlowMode ? (
          <SlowModeSection
            conversationId={id}
            delay={groupInfo.slowModeDelay}
            onChanged={(seconds) => details.update((info) => ({ ...info, slowModeDelay: seconds }))}
          />
        ) : null}

        {canRemove && member ? (
          <MemberModeration
            conversationId={id}
            member={member}
            memberName={title}
            groupTitle={conversation.title}
            onRemoved={goBack}
          />
        ) : null}

        {member ? null : <SharedMedia conversationId={id} />}
      </ScrollView>
    </Screen>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-w-[84px] items-center gap-1 rounded-card bg-surface-sunken px-3 py-2.5">
      <Icon name={icon} size={20} color={colors.brand} />
      <Text variant="micro" className="font-medium text-content">
        {label}
      </Text>
    </Pressable>
  );
}
