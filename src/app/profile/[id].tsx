import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import {
  Avatar,
  BackHeader,
  Badge,
  Card,
  ConfirmSheet,
  Icon,
  ListItem,
  Pressable,
  RowIcon,
  Screen,
  Section,
  Text,
  toast,
  type IconName,
  useThemeColors,
} from '@/design';
import { shortAddress } from '@/core/identity/keyring';
import { isLocalConversation } from '@/core/messaging/bots';
import { selfIdFor, useChatStore } from '@/core/messaging/chat-store';
import {
  countsFor,
  entriesOf,
  type MediaCategory,
  type MediaEntry,
} from '@/core/messaging/media-index';
import { formatDayLabel } from '@/core/messaging/preview';
import { errorMessage } from '@/core/errors';
import {
  conversationPeers,
  conversationTitle,
  useDisplayNames,
} from '@/features/chat/use-display-names';
import { useBack } from '@/features/navigation/use-back';
import { openChatFromProfile } from '@/features/navigation/open';
import { resolveEnsProfile, type EnsProfile } from '@/lib/evm/ens-profile';
import { protocolSubtitle } from '@/features/protocols/presentation';
import { openInBrowser } from '@/lib/open-url';

const TABS: { id: MediaCategory; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'files', label: 'Files' },
  { id: 'voice', label: 'Voice' },
  { id: 'links', label: 'Links' },
  { id: 'gifs', label: 'GIFs' },
];

export default function ProfileScreen() {
  const { id, member } = useLocalSearchParams<{ id: string; member?: string }>();
  const goBack = useBack('/chats');
  const { width } = useWindowDimensions();

  const conversations = useChatStore((s) => s.conversations);
  const sessions = useChatStore((s) => s.sessions);
  const mediaIndex = useChatStore((s) => s.mediaIndex);
  const chatPrefs = useChatStore((s) => s.chatPrefs);
  const setChatPref = useChatStore((s) => s.setChatPref);

  const conversation = conversations.find((c) => c.id === id);
  const selfId = selfIdFor({ sessions }, conversation?.protocol);
  const peers = conversation ? conversationPeers(conversation, selfId) : [];
  const { nameFor, addressFor } = useDisplayNames(peers);

  const [tab, setTab] = useState<MediaCategory>('media');
  const [ens, setEns] = useState<EnsProfile | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const focusId = member ?? peers[0]?.id;
  const peerAddress = focusId ? addressFor?.(focusId) : undefined;

  useEffect(() => {
    if (!peerAddress?.startsWith('0x')) return;
    let cancelled = false;
    resolveEnsProfile(peerAddress as `0x${string}`).then((profile) => {
      if (!cancelled) setEns(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [peerAddress]);

  const counts = countsFor(mediaIndex, id);
  const entries = entriesOf(mediaIndex, id, tab);

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

  const title = ens?.name ?? (member ? nameFor(member) : conversationTitle(conversation, selfId, nameFor));
  const canRemove =
    Boolean(member) &&
    member !== selfId &&
    conversation.kind === 'group' &&
    (conversation.selfRole === 'owner' || conversation.selfRole === 'admin');
  const muted = Boolean(chatPrefs[id]?.muted);
  const cell = Math.floor((Math.min(width, 720) - 4 * 2) / 3) - 2;

  return (
    <Screen className="px-0" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader label="Back" onPress={goBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="items-center gap-3 px-gutter pb-5">
          {ens?.avatar ? (
            <Image
              source={{ uri: ens.avatar }}
              style={{ width: 96, height: 96, borderRadius: 48 }}
              contentFit="cover"
            />
          ) : (
            <Avatar
              seed={focusId ?? conversation.id}
              size="xl"
              label={!member && conversation.kind === 'group' ? conversation.title : undefined}
            />
          )}

          <View className="items-center gap-1">
            <Text variant="headline">{title}</Text>
            {ens?.name ? (
              <Badge
                label={
                  ens.paidUntil
                    ? `ENS · held through ${ens.paidUntil.getFullYear()}`
                    : 'ENS name'
                }
                tone="success"
              />
            ) : null}
            <Text variant="micro">{protocolSubtitle(conversation.protocol)}</Text>
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
          <Action
            icon="copy-outline"
            label="Copy"
            onPress={async () => {
              const value = peerAddress ?? focusId ?? '';
              if (!value) return;
              await Clipboard.setStringAsync(value);
              toast.success('Copied');
            }}
          />
        </View>

        {peerAddress ? (
          <Card className="mx-gutter mb-5 gap-1">
            <Text variant="caption">Address</Text>
            <Text variant="mono" selectable>
              {shortAddress(peerAddress, 12, 10)}
            </Text>
            {ens?.description ? (
              <Text variant="footnote" className="pt-1">
                {ens.description}
              </Text>
            ) : null}
            {ens?.paidUntil ? (
              <Text variant="micro" className="pt-1">
                {ens.name} is registered until{' '}
                {ens.paidUntil.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                . Anyone can pick a display name; only the holder can renew this one.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {canRemove ? (
          <Section surface="card" className="mb-5">
            <ListItem
              testID="profile-remove-member"
              title="Remove from group"
              subtitle="They stop receiving messages. Rejoining needs a fresh invite."
              numberOfLinesSubtitle={2}
              leading={<RowIcon name="person-remove-outline" tone="red" />}
              onPress={() => setRemoving(true)}
            />
          </Section>
        ) : null}

        {member ? null : (
        <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-gutter pb-3">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.label}, ${counts[entry.id]}`}
                onPress={() => setTab(entry.id)}
                className={
                  active
                    ? 'flex-row items-center gap-1.5 rounded-pill bg-brand px-3 py-1.5'
                    : 'flex-row items-center gap-1.5 rounded-pill bg-surface-sunken px-3 py-1.5'
                }>
                <Text
                  variant="caption"
                  className={active ? 'font-semibold text-brand-on' : 'font-medium text-content'}>
                  {entry.label}
                </Text>
                <Text
                  variant="micro"
                  className={active ? 'text-brand-on/80' : 'text-content-subtle'}>
                  {counts[entry.id]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {entries.length === 0 ? (
          <Text variant="footnote" className="px-gutter py-6">
            {isLocalConversation(id)
              ? 'Bot conversations do not share files.'
              : `Nothing shared in this conversation yet.`}
          </Text>
        ) : tab === 'media' || tab === 'gifs' ? (
          <View className="flex-row flex-wrap gap-0.5 px-1">
            {entries.map((entry) => (
              <Image
                key={`${entry.messageId}-${entry.uri}`}
                source={{ uri: entry.uri }}
                style={{ width: cell, height: cell }}
                contentFit="cover"
              />
            ))}
          </View>
        ) : (
          entries.map((entry) => (
            <MediaRow key={`${entry.messageId}-${entry.uri}`} entry={entry} category={tab} />
          ))
        )}
        </>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={removing}
        onClose={() => setRemoving(false)}
        title={`Remove ${title} from ${conversation.title}?`}
        body="They stop receiving messages from this group immediately. Nothing they already received is recalled, and rejoining needs a fresh invite from an admin."
        busy={busy}
        confirm={{
          testID: 'confirm-remove-member',
          label: 'Remove from group',
          tone: 'danger',
          onPress: async () => {
            if (!member) return;
            setBusy(true);
            try {
              await useChatStore.getState().removeMembers(id, [member]);
              toast.success('Removed');
              setRemoving(false);
              goBack();
            } catch (e) {
              toast.error(errorMessage(e, 'Could not remove them'));
            }
            setBusy(false);
          },
        }}
      />
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
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

function MediaRow({ entry, category }: { entry: MediaEntry; category: MediaCategory }) {
  const colors = useThemeColors();
  const icon: IconName =
    category === 'voice'
      ? 'mic-outline'
      : category === 'links'
        ? 'link-outline'
        : 'document-outline';

  return (
    <ListItem
      title={entry.label ?? entry.uri}
      subtitle={formatDayLabel(entry.sentAt)}
      leading={<Icon name={icon} size={20} color={colors['content-muted']} />}
      onPress={() => {
        openInBrowser(entry.uri).catch(() => {});
      }}
    />
  );
}
