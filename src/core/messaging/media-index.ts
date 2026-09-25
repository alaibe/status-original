import type { AccountStorage } from '@/storage/account';
import { deferredWrite } from '@/storage/deferred-write';
import type { ChatMessage, ConversationId, MessageId } from './types';

export type MediaCategory = 'media' | 'files' | 'voice' | 'links' | 'gifs';

export interface MediaEntry {
  messageId: MessageId;
  category: MediaCategory;
  sentAt: number;
  uri: string;
  label?: string;
  mimeType?: string;
}

export type MediaIndex = Record<ConversationId, MediaEntry[]>;

const KEY = 'chat.mediaIndex';

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;

export function extractLinks(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  return found.map((url) => url.replace(/[.,;:!?)\]]+$/, ''));
}

export function entriesFor(message: ChatMessage): MediaEntry[] {
  const { content, id, sentAt } = message;

  if (content.kind === 'image') {
    const isGif =
      content.mimeType === 'image/gif' || (content.name ?? '').toLowerCase().endsWith('.gif');
    return [
      {
        messageId: id,
        category: isGif ? 'gifs' : 'media',
        sentAt,
        uri: content.uri,
        label: content.caption ?? content.name,
        mimeType: content.mimeType,
      },
    ];
  }

  if (content.kind === 'voice') {
    return [{ messageId: id, category: 'voice', sentAt, uri: content.uri, label: content.name }];
  }

  if (content.kind === 'file') {
    return [
      {
        messageId: id,
        category: 'files',
        sentAt,
        uri: content.uri,
        label: content.name,
        mimeType: content.mimeType,
      },
    ];
  }

  if (content.kind === 'text') {
    return extractLinks(content.text).map((url) => ({
      messageId: id,
      category: 'links' as const,
      sentAt,
      uri: url,
      label: url,
    }));
  }

  return [];
}

export function indexMessages(
  index: MediaIndex,
  conversationId: ConversationId,
  messages: ChatMessage[]
): MediaIndex {
  const existing = index[conversationId] ?? [];
  const seen = new Set(existing.map((e) => `${e.messageId}:${e.uri}`));

  const added: MediaEntry[] = [];
  for (const message of messages) {
    for (const entry of entriesFor(message)) {
      const key = `${entry.messageId}:${entry.uri}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(entry);
    }
  }

  if (added.length === 0) return index;
  return {
    ...index,
    [conversationId]: [...existing, ...added].sort((a, b) => b.sentAt - a.sentAt),
  };
}

export function entriesOf(
  index: MediaIndex,
  conversationId: ConversationId,
  category: MediaCategory
): MediaEntry[] {
  return (index[conversationId] ?? []).filter((e) => e.category === category);
}

export function countsFor(
  index: MediaIndex,
  conversationId: ConversationId
): Record<MediaCategory, number> {
  const counts: Record<MediaCategory, number> = {
    media: 0,
    files: 0,
    voice: 0,
    links: 0,
    gifs: 0,
  };
  for (const entry of index[conversationId] ?? []) counts[entry.category] += 1;
  return counts;
}

export async function loadMediaIndex(storage: AccountStorage): Promise<MediaIndex> {
  return (await storage.get<MediaIndex>(KEY)) ?? {};
}

export const { saveSoon: saveMediaIndexSoon, flush: flushMediaIndex } = deferredWrite<MediaIndex>(
  KEY,
  1_000
);
