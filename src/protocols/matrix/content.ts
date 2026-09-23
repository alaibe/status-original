import { htmlToMarkdown } from '@/core/messaging/html-markdown';
import { labelled, unsupported } from '@/core/messaging/preview';
import type { MessageContent } from '@/core/messaging/types';

import type { MxEvent, MxMedia, MxMembershipChange, MxStateChange } from './api';

/** Bots write links as Markdown autolinks; the brackets are not part of the URL. */
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/g;

export interface ContentContext {
  selfId?: string;
  /** A file's local URI once downloaded; null while it is still being fetched. */
  media(media: MxMedia): string | null;
  nameOf(userId: string): string;
  learnName(userId: string, name: string): void;
  learnPoll(eventId: string, answerIds: string[]): void;
}

const MEMBERSHIP: Record<MxMembershipChange, (who: string, by: string) => string> = {
  joined: (who) => `${who} joined`,
  left: (who) => `${who} left`,
  invited: (who, by) => `${by} invited ${who}`,
  kicked: (who, by) => `${by} removed ${who}`,
  banned: (who, by) => `${by} banned ${who}`,
  unbanned: (who, by) => `${by} unbanned ${who}`,
  invitationRejected: (who) => `${who} declined the invitation`,
  invitationRevoked: (who, by) => `${by} withdrew the invitation for ${who}`,
};

const STATE: Record<MxStateChange, (value?: string) => string> = {
  name: (value) => (value ? `Renamed to "${value}"` : 'Name removed'),
  topic: (value) => (value ? `Topic set to "${value}"` : 'Topic removed'),
  avatar: () => 'Room photo changed',
  created: () => 'Room created',
  encryption: () => 'Encryption enabled',
};

export function toContent(raw: MxEvent, context: ContentContext): MessageContent {
  const content = raw.content;
  switch (content.kind) {
    case 'text': {
      const body = content.html
        ? htmlToMarkdown(content.html)
        : content.body.replace(AUTOLINK, '$1');
      return { kind: 'text', text: content.msgtype === 'emote' ? `\\* ${body}` : body };
    }
    case 'image': {
      const uri = context.media(content);
      if (!uri) return unsupported('image', labelled('📷 Photo', content.caption));
      return {
        kind: 'image',
        uri,
        name: content.name,
        width: content.width,
        height: content.height,
        size: content.size,
        mimeType: content.mimeType,
        caption: content.caption,
      };
    }
    case 'file': {
      const uri = context.media(content);
      if (!uri) return unsupported('file', labelled(`📎 ${content.name}`, content.caption));
      return {
        kind: 'file',
        uri,
        name: content.name,
        mimeType: content.mimeType,
        size: content.size,
      };
    }
    case 'audio': {
      if (!content.voice) return unsupported('audio', `🎵 ${content.name}`);
      const uri = context.media(content);
      if (!uri) return unsupported('voice', '🎤 Voice message');
      return {
        kind: 'voice',
        uri,
        durationMs: content.durationMs ?? 0,
        size: content.size,
        mimeType: content.mimeType,
      };
    }
    case 'video': {
      const uri = context.media(content);
      if (!uri) return unsupported('video', '🎬 Video');
      return {
        kind: 'video',
        uri,
        name: content.name,
        width: content.width,
        height: content.height,
        durationMs: content.durationMs,
        caption: content.caption,
        mimeType: content.mimeType,
        size: content.size,
      };
    }
    case 'poll': {
      context.learnPoll(
        raw.id,
        content.answers.map((answer) => answer.id)
      );
      const totalVoters = new Set(Object.values(content.votes).flat()).size;
      return {
        kind: 'poll',
        question: content.question,
        options: content.answers.map((answer) => {
          const voters = content.votes[answer.id] ?? [];
          return {
            text: answer.text,
            percentage: totalVoters ? Math.round((voters.length / totalVoters) * 100) : 0,
            chosen: voters.includes(context.selfId ?? ''),
          };
        }),
        totalVoters,
        multiple: content.maxSelections > 1,
        closed: content.closed,
      };
    }
    case 'sticker':
      return unsupported('sticker', content.body || 'Sticker');
    case 'location':
      return unsupported('location', '📍 Location');
    case 'redacted':
      return unsupported('redacted', 'Message deleted');
    case 'undecryptable':
      return unsupported('undecryptable', '🔒 Waiting for the keys to this message');
    case 'membership': {
      if (content.userName) context.learnName(content.user, content.userName);
      const text = MEMBERSHIP[content.change](
        context.nameOf(content.user),
        context.nameOf(raw.sender)
      );
      return { kind: 'system', text };
    }
    case 'state':
      return { kind: 'system', text: STATE[content.change](content.value) };
  }
}
