import { Avatar, type AvatarProps } from '@/design';
import { isLocalConversation } from '@/core/messaging/bots';
import type { Conversation, ParticipantId } from '@/core/messaging/types';
import { useBotAvatar } from './use-bot-avatar';

export function ConversationAvatar({
  conversation,
  selfId,
  size,
}: {
  conversation: Conversation;
  selfId: ParticipantId;
  size?: AvatarProps['size'];
}) {
  const isBot = isLocalConversation(conversation.id);
  const bot = useBotAvatar(conversation.id);
  const peer = conversation.memberIds.find((id) => id !== selfId) ?? conversation.id;

  return (
    <Avatar
      seed={isBot ? conversation.id : peer}
      size={size}
      label={conversation.kind === 'group' || isBot ? conversation.title : undefined}
      image={bot.avatar}
      emoji={bot.emoji}
    />
  );
}
