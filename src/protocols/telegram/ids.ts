import type { MessageId, ParticipantId } from '@/core/messaging/types';

import type { TdSender } from './types';

export function messageIdOf(chatId: number, messageId: number): MessageId {
  return `${chatId}_${messageId}`;
}

export function tdMessageId(id: MessageId): number {
  return Number(id.slice(id.lastIndexOf('_') + 1));
}

export function senderIdOf(sender: TdSender): ParticipantId {
  return sender['@type'] === 'messageSenderUser' ? String(sender.user_id) : `c${sender.chat_id}`;
}

export function userSender(id: ParticipantId): TdSender {
  return { '@type': 'messageSenderUser', user_id: Number(id) };
}

export function userIdOf(sender: TdSender): number {
  return sender['@type'] === 'messageSenderUser' ? sender.user_id : sender.chat_id;
}

export function chatSenderId(id: ParticipantId): number | null {
  return /^c-?\d+$/.test(id) ? Number(id.slice(1)) : null;
}

export function supergroupChatId(supergroupId: number): number {
  return -1_000_000_000_000 - supergroupId;
}
