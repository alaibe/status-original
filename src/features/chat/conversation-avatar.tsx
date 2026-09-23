import { View } from 'react-native';

import { Avatar, type AvatarProps, NetworkMark } from '@/design';
import { isLocalConversation } from '@/core/messaging/bots';
import type { Conversation, ParticipantId } from '@/core/messaging/types';
import { useBotAvatar } from './use-bot-avatar';

export function ConversationAvatar({
  conversation,
  selfId,
  size,
  network,
}: {
  conversation: Conversation;
  selfId: ParticipantId;
  size?: AvatarProps['size'];
  network?: string;
}) {
  const isBot = isLocalConversation(conversation.id);
  const bot = useBotAvatar(conversation.id);
  const peer = conversation.memberIds.find((id) => id !== selfId) ?? conversation.id;

  const avatar = (
    <Avatar
      seed={isBot ? conversation.id : peer}
      size={size}
      label={
        conversation.kind === 'group' || isBot ? conversation.title.replace(/^#/, '') : undefined
      }
      image={bot.avatar}
      emoji={bot.emoji}
    />
  );
  if (!network) return avatar;

  return (
    <View>
      {avatar}
      <View className="absolute -bottom-0.5 -right-0.5 rounded-pill border-2 border-surface">
        <NetworkMark network={network} />
      </View>
    </View>
  );
}
