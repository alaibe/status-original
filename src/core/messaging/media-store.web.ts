import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { bytesToBase64 } from '@/lib/bytes';

import type { StoredMedia } from './media-store';

export type { StoredMedia } from './media-store';

// Files this session has already handed to the Rust side, so a message that
// is converted again (every chat open lists its attachments) skips the copy.
const stored = new Map<string, string>();

const storedKey = (area: string, name: string, accountId: string) => `${accountId}/${area}/${name}`;

async function statMedia(area: string, name: string, accountId: string): Promise<StoredMedia | null> {
  const found = await invoke<[string, number] | null>('media_stat', { accountId, area, name });
  return found ? { uri: convertFileSrc(found[0]), size: found[1] } : null;
}

/** `blob:`, `data:` and `asset:` URIs are all fetchable in the window. */
export async function readMediaBase64(uri: string): Promise<{ data: string; size: number }> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Could not read ${uri}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { data: bytesToBase64(bytes), size: bytes.length };
}

export async function storeMedia(
  area: string,
  name: string,
  accountId: string,
  base64: string,
): Promise<string> {
  const key = storedKey(area, name, accountId);
  const known = stored.get(key);
  if (known) return known;
  const path = await invoke<string>('media_write', { accountId, area, name, base64 });
  const uri = convertFileSrc(path);
  stored.set(key, uri);
  return uri;
}

export async function adoptMedia(
  area: string,
  name: string,
  accountId: string,
  sourceUri: string,
): Promise<string> {
  const existing = await statMedia(area, name, accountId);
  if (existing) return existing.uri;
  const { data } = await readMediaBase64(sourceUri);
  const uri = await storeMedia(area, name, accountId, data);
  if (sourceUri.startsWith('blob:')) URL.revokeObjectURL(sourceUri);
  return uri;
}

/** A picker or recorder hands the window a blob or data URL that dies with the page. */
export function isTransientUri(uri: string): boolean {
  return uri.startsWith('blob:') || uri.startsWith('data:');
}

export function basenameOf(uri: string): string | undefined {
  if (isTransientUri(uri)) return undefined;
  const last = uri.split('?')[0].split('/').pop();
  return last ? decodeURIComponent(last) : undefined;
}

export async function downloadMedia(
  area: string,
  name: string,
  accountId: string,
  url: string,
): Promise<StoredMedia> {
  const existing = await statMedia(area, name, accountId);
  if (existing) return existing;
  const { data, size } = await readMediaBase64(url);
  return { uri: await storeMedia(area, name, accountId, data), size };
}
