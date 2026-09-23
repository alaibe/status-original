import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionSheet,
  Card,
  ConfirmSheet,
  copyText,
  type IconName,
  ListItem,
  Pressable,
  RowIcon,
  Section,
  Text,
  toast,
} from '@/design';
import { useChatStore } from '@/core/messaging/chat-store';
import type { GroupInfo } from '@/core/messaging/protocol';
import type { ConversationId, ParticipantId } from '@/core/messaging/types';

import { useKeyedLoad } from '@/lib/use-keyed-load';

import { useAction } from './use-action';
import { useSupports } from './use-supports';

const SLOW_MODE: { seconds: number; label: string }[] = [
  { seconds: 0, label: 'Off' },
  { seconds: 5, label: '5 seconds' },
  { seconds: 10, label: '10 seconds' },
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
];

export function GroupAbout({ info, error }: { info?: GroupInfo; error?: string }) {
  if (!info?.description && !info?.link && !error) return null;
  return (
    <Card className="mx-gutter mb-5 gap-3">
      {info?.description ? (
        <View className="gap-1">
          <Text variant="caption">About</Text>
          <Text selectable>{info.description}</Text>
        </View>
      ) : null}
      {info?.link ? <LinkRow label="Link" link={info.link} /> : null}
      {error ? (
        <Text variant="caption" className="text-danger">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

function LinkRow({ label, link }: { label: string; link: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label.toLowerCase()}`}
      onPress={() => void copyText(link, 'Link copied')}
      className="gap-1">
      <Text variant="caption">{label}</Text>
      <Text className="text-brand" selectable>
        {link}
      </Text>
    </Pressable>
  );
}

export function InviteLinks({
  conversationId,
  visible,
  onClose,
}: {
  conversationId: ConversationId;
  visible: boolean;
  onClose: () => void;
}) {
  const createInviteLink = useChatStore((s) => s.createInviteLink);
  const [created, setCreated] = useState<{ link: string; approval: boolean } | null>(null);
  const create = useAction(
    async (approval: boolean) => {
      const link = await createInviteLink(conversationId, approval);
      setCreated({ link, approval });
      await copyText(link, approval ? 'Approval link copied' : 'Invite link copied');
    },
    { failure: 'Could not create invite link' }
  );

  return (
    <>
      {created ? (
        <Card className="mx-gutter mb-5">
          <LinkRow
            label={`${created.approval ? 'Approval link' : 'Invite link'} · copied`}
            link={created.link}
          />
        </Card>
      ) : null}
      <ActionSheet
        visible={visible}
        onClose={onClose}
        title="Invite people"
        actions={[
          {
            label: 'Create invite link',
            icon: 'link-outline',
            onPress: () => void create.run(false),
          },
          {
            label: 'Create link that needs approval',
            icon: 'person-add-outline',
            onPress: () => void create.run(true),
          },
        ]}
      />
    </>
  );
}

export function SlowModeSection({
  conversationId,
  delay,
  onChanged,
}: {
  conversationId: ConversationId;
  delay?: number;
  onChanged: (seconds: number) => void;
}) {
  const setSlowModeDelay = useChatStore((s) => s.setSlowModeDelay);
  const [open, setOpen] = useState(false);
  const change = useAction(
    async (seconds: number) => {
      await setSlowModeDelay(conversationId, seconds);
      onChanged(seconds);
    },
    { success: 'Slow mode updated', failure: 'Could not update slow mode' }
  );

  return (
    <Section title="Moderation" surface="card" className="mb-5">
      <ListItem
        title="Slow mode"
        subtitle={SLOW_MODE.find((option) => option.seconds === delay)?.label ?? 'Off'}
        leading={<RowIcon name="time-outline" />}
        onPress={() => setOpen(true)}
      />
      <ActionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Slow mode"
        actions={SLOW_MODE.map((option) => ({
          label: option.label,
          selected: option.seconds === delay,
          onPress: () => void change.run(option.seconds),
        }))}
      />
    </Section>
  );
}

type Removal = 'remove' | 'ban';

const REMOVAL: Record<
  Removal,
  { title: string; subtitle: string; confirm: string; body: string; done: string; icon: IconName }
> = {
  remove: {
    title: 'Remove from group',
    subtitle: 'They can come back with an invite or a link.',
    confirm: 'Remove',
    body: 'They stop receiving messages from this group. Nothing they already received is recalled, and they can come back with an invite or a link.',
    done: 'Removed',
    icon: 'person-remove-outline',
  },
  ban: {
    title: 'Ban from group',
    subtitle: 'They are removed and cannot come back.',
    confirm: 'Ban',
    body: 'They stop receiving messages from this group and cannot join again, even with a link, until an admin lets them back in from another app.',
    done: 'Banned',
    icon: 'ban-outline',
  },
};

export function MemberModeration({
  conversationId,
  member,
  memberName,
  groupTitle,
  onRemoved,
}: {
  conversationId: ConversationId;
  member: ParticipantId;
  memberName: string;
  groupTitle: string;
  onRemoved: () => void;
}) {
  const { supports } = useSupports(conversationId);
  const getMembers = useChatStore((s) => s.getMembers);
  const removeMembers = useChatStore((s) => s.removeMembers);
  const banMember = useChatStore((s) => s.banMember);
  const setMemberMuted = useChatStore((s) => s.setMemberMuted);
  const canMute = supports('setMemberMuted');
  const members = useKeyedLoad(canMute ? conversationId : null, getMembers);
  const muted = members.value?.find((m) => m.id === member)?.muted ?? false;
  const [confirming, setConfirming] = useState<Removal | null>(null);

  const mute = useAction(
    async () => {
      await setMemberMuted(conversationId, member, !muted);
      members.update((list) => list.map((m) => (m.id === member ? { ...m, muted: !muted } : m)));
    },
    { success: muted ? 'They can send again' : 'Muted', failure: 'Could not change that' }
  );
  const remove = useAction(
    (removal: Removal) =>
      removal === 'ban'
        ? banMember(conversationId, member)
        : removeMembers(conversationId, [member]),
    { failure: 'Could not do that' }
  );
  const removals: Removal[] = supports('banMember') ? ['remove', 'ban'] : ['remove'];
  const shown = confirming ? REMOVAL[confirming] : null;

  return (
    <Section surface="card" className="mb-5">
      {canMute ? (
        <ListItem
          testID="profile-mute-member"
          title={muted ? 'Let them send messages' : 'Mute in group'}
          subtitle={
            muted ? 'They are muted: they read but cannot send.' : 'They stay, but cannot send.'
          }
          leading={<RowIcon name={muted ? 'mic-outline' : 'mic-off-outline'} />}
          onPress={members.loading ? undefined : () => void mute.run()}
        />
      ) : null}
      {removals.map((removal) => (
        <ListItem
          key={removal}
          testID={`profile-${removal}-member`}
          title={REMOVAL[removal].title}
          subtitle={REMOVAL[removal].subtitle}
          numberOfLinesSubtitle={2}
          leading={<RowIcon name={REMOVAL[removal].icon} tone="red" />}
          onPress={() => setConfirming(removal)}
        />
      ))}
      <ConfirmSheet
        visible={shown !== null}
        onClose={() => setConfirming(null)}
        title={`${shown?.confirm ?? ''} ${memberName} from ${groupTitle}?`}
        body={shown?.body ?? ''}
        busy={remove.busy}
        confirm={{
          testID: 'confirm-remove-member',
          label: shown?.title ?? '',
          tone: 'danger',
          onPress: async () => {
            if (!confirming || !(await remove.run(confirming))) return;
            toast.success(REMOVAL[confirming].done);
            setConfirming(null);
            onRemoved();
          },
        }}
      />
    </Section>
  );
}
