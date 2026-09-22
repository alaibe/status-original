/**
 * The slice of TDLib's JSON API this adapter reads. Field names follow TDLib
 * (https://core.telegram.org/tdlib/docs/td__api_8h.html), so they are
 * snake_case on purpose.
 */
import type { TdObject } from './api';

export interface TdUser extends TdObject {
  '@type': 'user';
  id: number;
  first_name: string;
  last_name: string;
  usernames?: { active_usernames: string[] };
  phone_number: string;
  type: { '@type': 'userTypeRegular' | 'userTypeBot' | 'userTypeDeleted' | 'userTypeUnknown' };
}

export type TdChatType =
  | { '@type': 'chatTypePrivate'; user_id: number }
  | { '@type': 'chatTypeBasicGroup'; basic_group_id: number }
  | { '@type': 'chatTypeSupergroup'; supergroup_id: number; is_channel: boolean }
  | { '@type': 'chatTypeSecret'; secret_chat_id: number; user_id: number };

export interface TdChatPosition {
  list: { '@type': 'chatListMain' | 'chatListArchive' | 'chatListFolder' };
  order: string;
}

export interface TdChat extends TdObject {
  '@type': 'chat';
  id: number;
  type: TdChatType;
  title: string;
  positions: TdChatPosition[];
  last_message?: TdMessage;
  last_read_outbox_message_id: number;
  block_list?: TdObject | null;
}

export type TdMemberStatus =
  | 'chatMemberStatusCreator'
  | 'chatMemberStatusAdministrator'
  | 'chatMemberStatusMember'
  | 'chatMemberStatusRestricted'
  | 'chatMemberStatusLeft'
  | 'chatMemberStatusBanned';

export interface TdBasicGroup extends TdObject {
  '@type': 'basicGroup';
  id: number;
  member_count: number;
  status: { '@type': TdMemberStatus };
}

export interface TdSupergroup extends TdObject {
  '@type': 'supergroup';
  id: number;
  member_count: number;
  status: { '@type': TdMemberStatus };
  is_channel: boolean;
}

export interface TdChatMember {
  member_id: TdSender;
  status: { '@type': TdMemberStatus };
}

export type TdSender =
  | { '@type': 'messageSenderUser'; user_id: number }
  | { '@type': 'messageSenderChat'; chat_id: number };

export interface TdFile extends TdObject {
  '@type': 'file';
  id: number;
  size: number;
  local: { path: string; is_downloading_completed: boolean; is_downloading_active: boolean };
}

export interface TdFormattedText {
  '@type': 'formattedText';
  text: string;
  entities: TdObject[];
}

export interface TdMessage extends TdObject {
  '@type': 'message';
  id: number;
  chat_id: number;
  sender_id: TdSender;
  date: number;
  is_outgoing: boolean;
  sending_state?: TdObject | null;
  reply_to?:
    | { '@type': 'messageReplyToMessage'; chat_id: number; message_id: number }
    | TdObject
    | null;
  forward_info?: TdObject | null;
  interaction_info?: {
    reactions?: { reactions: TdReaction[] } | null;
  } | null;
  content: TdObject;
}

export interface TdReaction {
  type: { '@type': 'reactionTypeEmoji'; emoji: string } | { '@type': string };
  total_count: number;
  is_chosen: boolean;
  recent_sender_ids: TdSender[];
}

export interface TdAuthorizationState extends TdObject {
  code_info?: {
    type: { '@type': string };
    next_type?: { '@type': string } | null;
  };
  password_hint?: string;
}

export interface TdMessages extends TdObject {
  '@type': 'messages';
  total_count: number;
  messages: (TdMessage | null)[];
}

export interface TdChats extends TdObject {
  '@type': 'chats';
  chat_ids: number[];
}

export interface TdChatMembers extends TdObject {
  '@type': 'chatMembers';
  members: TdChatMember[];
}

export interface TdBasicGroupFullInfo extends TdObject {
  '@type': 'basicGroupFullInfo';
  members: TdChatMember[];
}
