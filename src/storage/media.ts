import { Directory, File, Paths } from 'expo-file-system';

import { OWNED_DIRECTORIES } from './inventory';

export function mediaDirectory(area: string, accountId: string): Directory {
  const dir = new Directory(Paths.document, area, accountId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function mediaFile(area: string, name: string, accountId: string): File {
  return new File(mediaDirectory(area, accountId), name);
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
