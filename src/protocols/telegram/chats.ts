import type { GroupRole } from '@/core/messaging/types';

import type { TdChat, TdChatPosition, TdMemberStatus } from './types';

export function inMainList(chat: TdChat): boolean {
  return chat.positions.some((p) => p.list['@type'] === 'chatListMain' && p.order !== '0');
}

export function withPosition(
  positions: TdChatPosition[],
  position: TdChatPosition
): TdChatPosition[] {
  const rest = positions.filter((p) => p.list['@type'] !== position.list['@type']);
  return position.order === '0' ? rest : [...rest, position];
}

export function mapRole(status: TdMemberStatus | undefined): GroupRole {
  if (status === 'chatMemberStatusCreator') return 'owner';
  if (status === 'chatMemberStatusAdministrator') return 'admin';
  return 'member';
}

export function isCurrentMember(status: TdMemberStatus): boolean {
  return !['chatMemberStatusLeft', 'chatMemberStatusBanned'].includes(status);
}
