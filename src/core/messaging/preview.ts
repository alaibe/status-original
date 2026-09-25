import { plainText } from './markdown';
import type { ChatMessage, MessageContent } from './types';

export const unsupported = (typeId: string, fallback: string): MessageContent => ({
  kind: 'unsupported',
  typeId,
  fallback,
});

export const labelled = (label: string, caption?: string) =>
  caption ? `${label} · ${caption}` : label;

export function contentPreview(content: MessageContent): string {
  switch (content.kind) {
    case 'text':
      return plainText(content.text).replace(/\s+/g, ' ').trim();
    case 'system':
      return content.text;
    case 'widget':
      return content.fallback;
    case 'custom':
      return content.fallback ?? 'Rich message';
    case 'unsupported':
      return content.fallback;

    case 'image':
      if (content.mimeType === 'image/gif') return content.caption?.trim() || 'GIF';
      return content.caption?.trim() ? `\u{1F4F7} ${content.caption.trim()}` : '\u{1F4F7} Photo';
    case 'file':
      return `\u{1F4CE} ${content.name}`;
    case 'voice':
      return `\u{1F3A4} Voice message (${formatDuration(content.durationMs)})`;
    case 'video':
      if (content.gif) return content.caption?.trim() || 'GIF';
      return content.caption?.trim() ? `\u{1F3AC} ${content.caption.trim()}` : '\u{1F3AC} Video';
    case 'poll':
      return `\u{1F4CA} ${content.question}`;

    case 'reaction':
      return '';
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function messagePreview(message: ChatMessage | undefined): string {
  if (!message) return 'No messages yet';
  const preview = contentPreview(message.content);
  return preview || 'No messages yet';
}

export function formatTimestamp(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const elapsed = now - ms;

  if (new Date(now).toDateString() === date.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (elapsed < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDayLabel(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  if (now - ms < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function isNewDay(previousMs: number | undefined, ms: number): boolean {
  if (previousMs === undefined) return true;
  return new Date(previousMs).toDateString() !== new Date(ms).toDateString();
}
