import { adoptMedia, basenameOf, isTransientUri, readMediaBase64, storeMedia } from './media-store';
import type { MessageContent } from './types';

export const INLINE_LIMIT_BYTES = 700 * 1024;

export type AttachmentKind = 'image' | 'voice' | 'file';

export function classifyAttachment(mimeType?: string, filename?: string): AttachmentKind {
  const type = (mimeType ?? '').toLowerCase();
  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? '';

  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'heic', 'webp'].includes(ext)) {
    return 'image';
  }
  if (type === 'audio/m4a' || type === 'audio/mp4' || ext === 'm4a') return 'voice';
  return 'file';
}

export interface InlineAttachment {
  filename: string;
  mimeType: string;
  data: string;
}

export class AttachmentTooLargeError extends Error {
  constructor(readonly size: number) {
    super(
      `That file is ${Math.round(size / 1024)}KB. Files over ` +
        `${Math.round(INLINE_LIMIT_BYTES / 1024)}KB need somewhere to upload to, ` +
        `and this app does not ship a storage host.`
    );
    this.name = 'AttachmentTooLargeError';
  }
}

export async function readInlineAttachment(
  uri: string,
  filename: string,
  mimeType: string
): Promise<InlineAttachment> {
  const { data, size } = await readMediaBase64(uri);
  if (size > INLINE_LIMIT_BYTES) throw new AttachmentTooLargeError(size);

  return { filename, mimeType, data };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  heic: 'image/heic',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4a: 'audio/m4a',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
};

export function fallbackMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

export const ATTACHMENT_AREA = 'attachments';

const fileSafe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');

export async function writeInlineAttachment(
  messageId: string,
  attachment: InlineAttachment,
  accountId: string
): Promise<string> {
  const name = fileSafe(`${messageId}-${attachment.filename}`);
  return storeMedia(ATTACHMENT_AREA, name, accountId, attachment.data);
}

export async function persistLocalAttachment(
  messageId: string,
  content: MessageContent,
  accountId: string
): Promise<MessageContent> {
  if (
    content.kind !== 'image' &&
    content.kind !== 'video' &&
    content.kind !== 'file' &&
    content.kind !== 'voice'
  )
    return content;
  if (!isTransientUri(content.uri)) return content;

  const fallback = content.kind === 'voice' ? 'recording.m4a' : 'attachment';
  const name = fileSafe(`${messageId}-${content.name ?? basenameOf(content.uri) ?? fallback}`);
  const uri = await adoptMedia(ATTACHMENT_AREA, name, accountId, content.uri);
  return { ...content, uri };
}
