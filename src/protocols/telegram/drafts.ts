import type { TdObject } from './api';
import { formattedToMarkdown, markdownToFormatted } from './formatting';
import type { TdDraftMessage } from './types';

export function draftMessage(text: string): TdObject {
  return {
    '@type': 'draftMessage',
    reply_to: null,
    date: 0,
    content: {
      '@type': 'draftMessageContentText',
      text: markdownToFormatted(text),
      link_preview_options: null,
    },
    effect_id: 0,
    suggested_post_info: null,
  };
}

export function draftText(draft: TdDraftMessage | null | undefined): string {
  const text = draft?.content['@type'] === 'draftMessageContentText' ? draft.content.text : null;
  return text ? formattedToMarkdown(text) : '';
}
