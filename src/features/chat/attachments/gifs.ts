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
    `https://tenor.googleapis.com/v2/search?key=${encodeURIComponent(key)}` +
    `&q=${encodeURIComponent(query)}&limit=${limit}&media_filter=tinygif` +
    `&contentfilter=medium`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.status === 403 || response.status === 401
        ? 'That GIF key was rejected. Check it in Settings.'
        : `GIF search failed (${response.status})`
    );
  }

  const body = (await response.json()) as {
    results?: {
      id: string;
      content_description?: string;
      media_formats?: Record<string, { url: string; dims: [number, number] }>;
    }[];
  };

  return (body.results ?? [])
    .map((result) => {
      const tiny = result.media_formats?.tinygif;
      if (!tiny) return null;
      return {
        id: result.id,
        url: tiny.url,
        previewUrl: tiny.url,
        width: tiny.dims?.[0] ?? 0,
        height: tiny.dims?.[1] ?? 0,
        description: result.content_description ?? 'GIF',
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
