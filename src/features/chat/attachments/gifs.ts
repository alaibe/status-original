import { File } from 'expo-file-system';

import { mediaDirectory } from '@/storage/media';

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

export async function searchGifs(
  key: string,
  query: string,
  limit = 24
): Promise<Gif[]> {
  const url =
    `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search` +
    `?q=${encodeURIComponent(query)}&per_page=${limit}&rating=pg`;

  const response = await fetch(url);
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
  const file = new File(mediaDirectory('gifs', accountId), `${gif.id}.gif`);
  if (!file.exists) await File.downloadFileAsync(gif.url, file);

  const size = file.size ?? 0;
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
