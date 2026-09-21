import { Directory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** What Telegram lists for this app under Active Sessions. */
export const DEVICE = {
  model: Platform.OS === 'ios' ? 'iPhone' : 'Android',
  systemVersion: String(Platform.Version),
};

export async function databaseDirectory(accountId: string): Promise<string> {
  const dir = new Directory(Paths.document, 'tdlib', accountId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir.uri.replace(/^file:\/\//, '');
}

export async function eraseDatabase(accountId: string): Promise<void> {
  const dir = new Directory(Paths.document, 'tdlib', accountId);
  if (dir.exists) dir.delete();
}

/** How the app displays a file TDLib has on disk. */
export function localFileUri(path: string): string {
  return `file://${path}`;
}
