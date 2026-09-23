import { mentionIdOf } from '@/core/messaging/mentions';
import { markdownHtml, mentionedIds, plainText } from '@/core/messaging/markdown';
import type { MessageContent } from '@/core/messaging/types';
import { pathOfFileUri } from '@/storage/media';

import type { MxOutgoing, MxTextOutgoing } from './api';
import { permalink, USER_ID } from './ids';

export function outgoing(content: MessageContent): MxOutgoing {
  switch (content.kind) {
    case 'text':
      return textOutgoing(content.text);
    case 'image':
      return {
        kind: 'image',
        path: pathOfFileUri(content.uri),
        mimeType: content.mimeType,
        width: content.width,
        height: content.height,
        size: content.size,
        caption: content.caption,
      };
    case 'file':
      return {
        kind: 'file',
        path: pathOfFileUri(content.uri),
        name: content.name,
        mimeType: content.mimeType,
        size: content.size,
      };
    case 'video':
      return {
        kind: 'video',
        path: pathOfFileUri(content.uri),
        mimeType: content.mimeType,
        width: content.width,
        height: content.height,
        durationMs: content.durationMs,
        size: content.size,
        caption: content.caption,
      };
    case 'voice':
      return {
        kind: 'voice',
        path: pathOfFileUri(content.uri),
        durationMs: content.durationMs,
        mimeType: content.mimeType,
        size: content.size,
      };
    default:
      throw new Error(`Matrix cannot send "${content.kind}" content`);
  }
}

export function textOutgoing(text: string): MxTextOutgoing {
  const html = markdownHtml(text, (href) => {
    const id = mentionIdOf(href);
    return id ? permalink(id) : href;
  });
  const body = plainText(text);
  const mentions = [
    ...new Set([
      ...mentionedIds(text).filter((id) => USER_ID.test(id)),
      ...[...body.matchAll(/(?:^|[^\w@])(@[^:\s]+:[^\s,;!?]+)/g)]
        .map((match) => match[1].replace(/[.)\]]+$/, ''))
        .filter((id) => USER_ID.test(id)),
    ]),
  ];
  return {
    kind: 'text',
    body,
    ...(html ? { html } : {}),
    ...(mentions.length ? { mentions } : {}),
  };
}
