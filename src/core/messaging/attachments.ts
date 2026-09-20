import { File, Paths } from 'expo-file-system';

import { mediaFile } from '@/storage/media';
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
  const file = new File(uri);
  const size = file.size ?? 0;
  if (size > INLINE_LIMIT_BYTES) throw new AttachmentTooLargeError(size);

  return { filename, mimeType, data: await file.base64() };
}

export const ATTACHMENT_AREA = 'attachments';

export function writeInlineAttachment(
  messageId: string,
  attachment: InlineAttachment,
  accountId: string
): string {
  const safeName = attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = mediaFile(ATTACHMENT_AREA, `${messageId}-${safeName}`, accountId);

  if (!file.exists) {
    file.create({ intermediates: true });
    file.write(attachment.data, { encoding: 'base64' });
  }
  return file.uri;
}

export async function persistLocalAttachment(
  messageId: string,
  content: MessageContent,
  accountId: string,
): Promise<MessageContent> {
  if (content.kind !== 'image' && content.kind !== 'file' && content.kind !== 'voice') return content;
  if (!content.uri.startsWith('file:') && !content.uri.startsWith('content:')) return content;

  const source = new File(content.uri);
  const fallback = content.kind === 'voice' ? 'recording.m4a' : 'attachment';
  const name = (content.name ?? Paths.basename(content.uri) ?? fallback)
    .replace(/[^A-Za-z0-9._-]/g, '_');
  const destination = mediaFile(ATTACHMENT_AREA, `${messageId}-${name}`, accountId);
  if (!destination.exists) await source.copy(destination);
  return { ...content, uri: destination.uri };
}
