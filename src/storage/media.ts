import { Directory, File, Paths } from 'expo-file-system';

import { pathOfFileUri } from './file-uri';
import { OWNED_DIRECTORIES } from './inventory';

export { pathOfFileUri } from './file-uri';

export function mediaDirectory(area: string, accountId: string): Directory {
  const dir = new Directory(Paths.document, area, accountId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function mediaFile(area: string, name: string, accountId: string): File {
  return new File(mediaDirectory(area, accountId), name);
}

/** A protocol's own data directory (an `OWNED_DIRECTORIES` area), as a plain path for a native SDK. */
export async function accountDirectory(area: string, accountId: string): Promise<string> {
  return pathOfFileUri(mediaDirectory(area, accountId).uri);
}

export async function eraseAccountDirectory(area: string, accountId: string): Promise<void> {
  const dir = new Directory(Paths.document, area, accountId);
  if (dir.exists) dir.delete();
}

/** How the app displays a file a native SDK has on disk. */
export function localFileUri(path: string): string {
  return `file://${path}`;
}

export function eraseMedia(accountId: string): void {
  const failures: unknown[] = [];
  for (const area of OWNED_DIRECTORIES) {
    const dir = new Directory(Paths.document, area, accountId);
    try {
      if (dir.exists) dir.delete();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Could not erase account media.');
}
