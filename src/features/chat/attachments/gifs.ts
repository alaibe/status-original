
import { downloadMedia } from '@/core/messaging/media-store';

import { HttpError } from '@/core/errors';
import { readCredential, writeCredential } from '@/core/identity/credentials';
import { INLINE_LIMIT_BYTES } from '@/core/messaging/attachments';
import type { MessageContent } from '@/core/messaging/types';

export interface Gif {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  description: string;
}

export const loadGifKey = (accountId: string) => readCredential(accountId, 'gifs');
export const saveGifKey = (accountId: string, key: string) =>
  writeCredential(accountId, 'gifs', key);

export function searchGifs(key: string, query: string, limit = 24): Promise<Gif[]> {
  return fetchGifs(key, `search?q=${encodeURIComponent(query)}&per_page=${limit}`);
}

/** What KLIPY is showing everyone right now: the grid before a search. */
export function featuredGifs(key: string, limit = 30): Promise<Gif[]> {
  return fetchGifs(key, `trending?per_page=${limit}`);
}

async function fetchGifs(key: string, path: string): Promise<Gif[]> {
  const response = await fetch(
    `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${path}&rating=pg`
  );
  if (!response.ok) {
    // KLIPY answers an unknown key with 404, not 401.
    throw new HttpError(
      response.status,
      [401, 403, 404].includes(response.status)
        ? 'That GIF key was rejected. Check it in Settings.'
        : `GIF search failed (${response.status})`
    );
  }

  type KlipyFile = { url: string; width: number; height: number; size: number };
  const body = (await response.json()) as {
    data?: {
      data?: {
        id: number;
        title?: string;
        type?: string;
        file?: Partial<Record<'xs' | 'sm' | 'md' | 'hd', { gif?: KlipyFile }>>;
      }[];
    };
  };

  return (body.data?.data ?? [])
    .map((item) => {
      // Results can interleave `type: 'ad'` items.
      const { md, sm, xs } = item.file ?? {};
      const full = [md?.gif, sm?.gif, xs?.gif].find((f) => f && f.size <= INLINE_LIMIT_BYTES);
      if (item.type !== 'gif' || !sm?.gif || !full) return null;
      return {
        id: String(item.id),
        url: full.url,
        previewUrl: sm.gif.url,
        width: full.width,
        height: full.height,
        description: item.title ?? 'GIF',
      };
    })
    .filter((g): g is Gif => g !== null);
}

export async function gifToContent(accountId: string, gif: Gif): Promise<MessageContent> {
  const file = await downloadMedia('gifs', `${gif.id}.gif`, accountId, gif.url);

  const size = file.size;
  if (size > INLINE_LIMIT_BYTES) {
    throw new Error('That GIF is too large to send inline.');
  }

  return {
    kind: 'image',
    uri: file.uri,
    width: gif.width,
    height: gif.height,
    size,
    name: `${gif.id}.gif`,
    mimeType: 'image/gif',
    caption: undefined,
  };
}
