import { File, Paths } from 'expo-file-system';

import { mediaDirectory, mediaFile } from '@/storage/media';

export interface StoredMedia {
  uri: string;
  size: number;
}

/** Bytes of a picked, recorded or already stored file, as base64. */
export async function readMediaBase64(uri: string): Promise<{ data: string; size: number }> {
  const file = new File(uri);
  return { data: await file.base64(), size: file.size ?? 0 };
}

/** Keeps `base64` under the account's media unless that name is already there. */
export async function storeMedia(
  area: string,
  name: string,
  accountId: string,
  base64: string,
): Promise<string> {
  const file = mediaFile(area, name, accountId);
  if (!file.exists) {
    file.create({ intermediates: true });
    file.write(base64, { encoding: 'base64' });
  }
  return file.uri;
}

/** Copies a file the system handed over (a picker, a recording) into the account's media. */
export async function adoptMedia(
  area: string,
  name: string,
  accountId: string,
  sourceUri: string,
): Promise<string> {
  const source = new File(sourceUri);
  const destination = mediaFile(area, name, accountId);
  if (!destination.exists) await source.copy(destination);
  return destination.uri;
}

/** Whether a URI is something the system gave the app rather than media it already keeps. */
export function isTransientUri(uri: string): boolean {
  return uri.startsWith('file:') || uri.startsWith('content:');
}

export function basenameOf(uri: string): string | undefined {
  return Paths.basename(uri) || undefined;
}

export async function downloadMedia(
  area: string,
  name: string,
  accountId: string,
  url: string,
): Promise<StoredMedia> {
  const file = new File(mediaDirectory(area, accountId), name);
  if (!file.exists) await File.downloadFileAsync(url, file);
  return { uri: file.uri, size: file.size ?? 0 };
}
