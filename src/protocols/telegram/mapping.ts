import { labelled, unsupported } from '@/core/messaging/preview';
import type { ChatMessage, MessageContent, ParticipantId } from '@/core/messaging/types';

import type { TdObject } from './api';
import { formattedToMarkdown } from './formatting';
import { messageIdOf, senderIdOf, userIdOf } from './ids';
import type { TdFile, TdFormattedText, TdMessage } from './types';

export interface MappingContext {
  selfId?: ParticipantId;
  /** A file's URI once it is local; null while TDLib still has to fetch it. */
  media(file: TdFile): string | null;
  names(userIds: number[]): string;
}

export function toMessage(raw: TdMessage, context: MappingContext): ChatMessage {
  const replyTo =
    raw.reply_to?.['@type'] === 'messageReplyToMessage' &&
    (raw.reply_to as { chat_id: number }).chat_id === raw.chat_id
      ? messageIdOf(raw.chat_id, (raw.reply_to as { message_id: number }).message_id)
      : undefined;
  const reactions = reactionsOf(raw, context.selfId);
  return {
    id: messageIdOf(raw.chat_id, raw.id),
    conversationId: String(raw.chat_id),
    senderId: senderIdOf(raw.sender_id),
    sentAt: raw.date * 1000,
    content: toContent(raw, context),
    fromMe: raw.is_outgoing,
    status: !raw.sending_state
      ? 'sent'
      : raw.sending_state['@type'] === 'messageSendingStateFailed'
        ? 'failed'
        : 'sending',
    ...(replyTo ? { replyTo } : {}),
    ...(reactions ? { reactions } : {}),
    ...(raw.forward_info ? { forwarded: true } : {}),
    ...(raw.is_pinned ? { isPinned: true } : {}),
    ...(raw.edit_date ? { edited: true } : {}),
  };
}

/** TDLib lists a few recent senders per emoji; that is what there is to show. */
function reactionsOf(
  raw: TdMessage,
  selfId: ParticipantId | undefined
): Record<string, ParticipantId[]> | undefined {
  const list = raw.interaction_info?.reactions?.reactions;
  if (!list || list.length === 0) return undefined;
  const out: Record<string, ParticipantId[]> = {};
  for (const reaction of list) {
    if (reaction.type['@type'] !== 'reactionTypeEmoji') continue;
    const emoji = (reaction.type as { emoji: string }).emoji;
    const people = new Set(reaction.recent_sender_ids.map(senderIdOf));
    if (reaction.is_chosen && selfId) people.add(selfId);
    if (people.size > 0) out[emoji] = [...people];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface Input {
  content: TdObject;
  raw: TdMessage;
  context: MappingContext;
  caption?: string;
}

const SYSTEM_TEXT: Record<string, string> = {
  messageChatChangePhoto: 'Group photo changed',
  messageChatDeletePhoto: 'Group photo removed',
  messageBasicGroupChatCreate: 'Group created',
  messageSupergroupChatCreate: 'Group created',
  messagePinMessage: 'Message pinned',
  messageChatUpgradeTo: 'Group upgraded',
  messageChatUpgradeFrom: 'Group upgraded',
};

const senderName = ({ raw, context }: Input) => context.names([userIdOf(raw.sender_id)]);

const MAPPERS: Record<string, (input: Input) => MessageContent> = {
  messageText: ({ content }) => ({
    kind: 'text',
    text: formattedToMarkdown(content.text as TdFormattedText),
  }),

  messagePhoto: ({ content, context, caption }) => {
    const sizes = (content.photo as { sizes: { photo: TdFile; width: number; height: number }[] })
      .sizes;
    const size = sizes[sizes.length - 1];
    const uri = size ? context.media(size.photo) : null;
    if (!uri) return unsupported('photo', labelled('📷 Photo', caption));
    return {
      kind: 'image',
      uri,
      width: size.width,
      height: size.height,
      size: size.photo.size,
      ...(caption ? { caption } : {}),
    };
  },

  messageDocument: ({ content, context, caption }) => {
    const document = content.document as { document: TdFile; file_name: string; mime_type: string };
    const uri = context.media(document.document);
    if (!uri) return unsupported('document', labelled(`📎 ${document.file_name}`, caption));
    return {
      kind: 'file',
      uri,
      name: document.file_name,
      mimeType: document.mime_type,
      size: document.document.size,
    };
  },

  messageVoiceNote: ({ content, context }) => {
    const voice = content.voice_note as { voice: TdFile; duration: number; mime_type: string };
    const uri = context.media(voice.voice);
    if (!uri) return unsupported('voice', '🎤 Voice message');
    return {
      kind: 'voice',
      uri,
      durationMs: voice.duration * 1000,
      size: voice.voice.size,
      mimeType: voice.mime_type,
    };
  },

  messageVideo: ({ content, context, caption }) => {
    const video = content.video as {
      video: TdFile;
      width: number;
      height: number;
      duration: number;
    };
    const uri = context.media(video.video);
    if (!uri) return unsupported('video', labelled('🎬 Video', caption));
    return {
      kind: 'video',
      uri,
      width: video.width,
      height: video.height,
      durationMs: video.duration * 1000,
      ...(caption ? { caption } : {}),
    };
  },

  messagePoll: ({ content }) => {
    const poll = content.poll as {
      question: TdFormattedText;
      options: { text: TdFormattedText; vote_percentage: number; is_chosen: boolean }[];
      total_voter_count: number;
      type: { '@type': string; allow_multiple_answers?: boolean };
      is_closed: boolean;
    };
    return {
      kind: 'poll',
      question: poll.question.text,
      options: poll.options.map((option) => ({
        text: option.text.text,
        percentage: option.vote_percentage,
        chosen: option.is_chosen,
      })),
      totalVoters: poll.total_voter_count,
      multiple: poll.type['@type'] === 'pollTypeRegular' && !!poll.type.allow_multiple_answers,
      closed: poll.is_closed,
    };
  },

  messageSticker: ({ content }) => {
    const emoji = (content.sticker as { emoji?: string }).emoji;
    return unsupported('sticker', emoji ? `${emoji} Sticker` : 'Sticker');
  },
  messageAnimation: ({ content, context, caption }) => {
    const animation = content.animation as {
      animation: TdFile;
      mime_type: string;
      width: number;
      height: number;
    };
    const uri = context.media(animation.animation);
    if (!uri) return unsupported('animation', labelled('GIF', caption));
    const shape = { uri, width: animation.width, height: animation.height };
    const captioned = caption ? { caption } : {};
    return animation.mime_type === 'image/gif'
      ? { kind: 'image', ...shape, mimeType: 'image/gif', ...captioned }
      : { kind: 'video', ...shape, gif: true, ...captioned };
  },
  messageVideoNote: () => unsupported('videoNote', '📹 Video message'),
  messageAudio: ({ content, caption }) => {
    const audio = content.audio as { title?: string; file_name?: string };
    return unsupported(
      'audio',
      labelled(`🎵 ${audio.title || audio.file_name || 'Audio'}`, caption)
    );
  },
  messageLocation: () => unsupported('location', '📍 Location'),
  messageVenue: () => unsupported('location', '📍 Location'),
  messageContact: ({ content }) => {
    const contact = content.contact as { first_name: string; last_name: string };
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    return unsupported('contact', `👤 ${name}`);
  },
  messageDice: ({ content }) =>
    unsupported('dice', `${content.emoji as string} ${content.value as number}`),

  messageChatAddMembers: ({ content, context }) => ({
    kind: 'system',
    text: `${context.names(content.member_user_ids as number[])} joined`,
  }),
  messageChatDeleteMember: ({ content, context }) => ({
    kind: 'system',
    text: `${context.names([content.user_id as number])} left`,
  }),
  messageChatJoinByLink: (input) => ({ kind: 'system', text: `${senderName(input)} joined` }),
  messageChatJoinByRequest: (input) => ({ kind: 'system', text: `${senderName(input)} joined` }),
  messageContactRegistered: (input) => ({
    kind: 'system',
    text: `${senderName(input)} joined Telegram`,
  }),
  messageChatChangeTitle: ({ content }) => ({
    kind: 'system',
    text: `Renamed to "${content.title as string}"`,
  }),
};

export function toContent(raw: TdMessage, context: MappingContext): MessageContent {
  const content = raw.content;
  const type = content['@type'];
  if (SYSTEM_TEXT[type]) return { kind: 'system', text: SYSTEM_TEXT[type] };
  const map = MAPPERS[type];
  if (!map) return unsupported(type, 'Unsupported message');
  const caption = content.caption
    ? formattedToMarkdown(content.caption as TdFormattedText).trim() || undefined
    : undefined;
  return map({ content, raw, context, caption });
}
