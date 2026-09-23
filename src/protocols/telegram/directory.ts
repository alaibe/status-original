import type { GroupMember, GroupRole, ParticipantId } from '@/core/messaging/types';

import type { TdApi } from './api';
import { isCurrentMember, mapRole } from './chats';
import { senderIdOf } from './ids';
import type {
  TdBasicGroup,
  TdBasicGroupFullInfo,
  TdChat,
  TdChatMember,
  TdChatMembers,
  TdStatus,
  TdSupergroup,
  TdUser,
} from './types';
import { nameOf } from './users';

const MEMBER_PAGE = 200;

export class TdDirectory {
  readonly chats = new Map<number, TdChat>();
  readonly users = new Map<number, TdUser>();
  readonly basicGroups = new Map<number, TdBasicGroup>();
  readonly supergroups = new Map<number, TdSupergroup>();
  readonly members = new Map<number, Promise<GroupMember[]>>();

  constructor(
    private readonly api: () => TdApi,
    private readonly selfId: () => ParticipantId
  ) {}

  clear(): void {
    this.chats.clear();
    this.users.clear();
    this.basicGroups.clear();
    this.supergroups.clear();
    this.members.clear();
  }

  async requireChat(chatId: number): Promise<TdChat> {
    const cached = this.chats.get(chatId);
    if (cached) return cached;
    const chat = await this.api().send<TdChat>({ '@type': 'getChat', chat_id: chatId });
    this.chats.set(chat.id, chat);
    return chat;
  }

  async userFor(id: ParticipantId): Promise<TdUser | null> {
    if (!/^\d+$/.test(id)) return null;
    const cached = this.users.get(Number(id));
    if (cached) return cached;
    const user = await this.api()
      .send<TdUser>({ '@type': 'getUser', user_id: Number(id) })
      .catch(() => null);
    if (user?.['@type'] !== 'user') return null;
    this.users.set(user.id, user);
    return user;
  }

  roleIn(chat: TdChat): GroupRole {
    return mapRole(this.statusIn(chat)?.['@type']);
  }

  rightsIn(chat: TdChat): { canPin: boolean; canDeleteOthers: boolean } {
    const type = chat.type;
    const status = this.statusIn(chat);
    if (type['@type'] === 'chatTypePrivate' || status?.['@type'] === 'chatMemberStatusCreator')
      return { canPin: true, canDeleteOthers: true };
    if (status?.['@type'] === 'chatMemberStatusAdministrator') {
      const channel = type['@type'] === 'chatTypeSupergroup' && type.is_channel;
      return {
        canPin: !!(channel ? status.rights?.can_edit_messages : status.rights?.can_pin_messages),
        canDeleteOthers: !!status.rights?.can_delete_messages,
      };
    }
    const permissions =
      status?.['@type'] === 'chatMemberStatusRestricted' ? status.permissions : chat.permissions;
    return { canPin: !!permissions?.can_pin_messages, canDeleteOthers: false };
  }

  private statusIn(chat: TdChat): TdStatus | undefined {
    const type = chat.type;
    return type['@type'] === 'chatTypeBasicGroup'
      ? this.basicGroups.get(type.basic_group_id)?.status
      : type['@type'] === 'chatTypeSupergroup'
        ? this.supergroups.get(type.supergroup_id)?.status
        : undefined;
  }

  canSend(chat: TdChat): boolean {
    const type = chat.type;
    if (type['@type'] === 'chatTypePrivate') return true;
    const role = this.roleIn(chat);
    const group =
      type['@type'] === 'chatTypeSupergroup' ? this.supergroups.get(type.supergroup_id) : undefined;
    if (type['@type'] === 'chatTypeSupergroup' && type.is_channel) {
      return (
        role === 'owner' || (role === 'admin' && group?.status.rights?.can_post_messages === true)
      );
    }
    if (role === 'owner' || role === 'admin') return true;
    if (group?.status['@type'] === 'chatMemberStatusRestricted') {
      return group.status.permissions?.can_send_basic_messages ?? false;
    }
    return chat.permissions?.can_send_basic_messages ?? true;
  }

  membersOf(chat: TdChat): Promise<GroupMember[]> {
    let pending = this.members.get(chat.id);
    if (!pending) {
      pending = this.fetchMembers(chat).catch(() => [
        { id: this.selfId(), role: 'member' as const },
      ]);
      this.members.set(chat.id, pending);
    }
    return pending;
  }

  private async fetchMembers(chat: TdChat): Promise<GroupMember[]> {
    const type = chat.type;
    let raw: TdChatMember[];
    if (type['@type'] === 'chatTypeBasicGroup') {
      const info = await this.api().send<TdBasicGroupFullInfo>({
        '@type': 'getBasicGroupFullInfo',
        basic_group_id: type.basic_group_id,
      });
      raw = info.members;
    } else if (type['@type'] === 'chatTypeSupergroup') {
      const page = await this.api().send<TdChatMembers>({
        '@type': 'getSupergroupMembers',
        supergroup_id: type.supergroup_id,
        offset: 0,
        limit: MEMBER_PAGE,
      });
      raw = page.members;
    } else if (type['@type'] === 'chatTypePrivate') {
      return [
        { id: String(type.user_id), role: 'member' },
        { id: this.selfId(), role: 'member' },
      ];
    } else {
      return [];
    }
    return raw
      .filter((member) => isCurrentMember(member.status['@type']))
      .map((member) => ({
        id: senderIdOf(member.member_id),
        role: mapRole(member.status['@type']),
        ...(member.status['@type'] === 'chatMemberStatusRestricted' &&
        !member.status.permissions?.can_send_basic_messages
          ? { muted: true }
          : {}),
      }));
  }

  namesOf(userIds: number[]): string {
    return userIds
      .map((id) => {
        const user = this.users.get(id);
        return user ? nameOf(user) : String(id);
      })
      .join(', ');
  }
}
