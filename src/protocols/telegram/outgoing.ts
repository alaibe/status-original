import type { MessageContent } from '@/core/messaging/types';
import { pathOfFileUri } from '@/storage/media';

import type { TdObject } from './api';
import { markdownToFormatted } from './formatting';

export function inputContent(content: MessageContent): TdObject {
  switch (content.kind) {
    case 'text':
      return { '@type': 'inputMessageText', text: markdownToFormatted(content.text) };
    case 'image':
      return {
        '@type': 'inputMessagePhoto',
        photo: localFile(content.uri),
        width: content.width ?? 0,
        height: content.height ?? 0,
        ...(content.caption ? { caption: markdownToFormatted(content.caption) } : {}),
      };
    case 'file':
      return { '@type': 'inputMessageDocument', document: localFile(content.uri) };
    case 'voice':
      return {
        '@type': 'inputMessageVoiceNote',
        voice_note: localFile(content.uri),
        duration: Math.round(content.durationMs / 1000),
      };
    case 'video':
      return {
        '@type': 'inputMessageVideo',
        video: localFile(content.uri),
        thumbnail: null,
        cover: null,
        start_timestamp: 0,
        added_sticker_file_ids: [],
        duration: Math.round((content.durationMs ?? 0) / 1000),
        width: content.width ?? 0,
        height: content.height ?? 0,
        supports_streaming: true,
        caption: content.caption ? markdownToFormatted(content.caption) : null,
        show_caption_above_media: false,
        self_destruct_type: null,
        has_spoiler: false,
      };
    default:
      throw new Error(`Telegram cannot send "${content.kind}" content`);
  }
}

function localFile(uri: string): TdObject {
  return { '@type': 'inputFileLocal', path: pathOfFileUri(uri) };
}
