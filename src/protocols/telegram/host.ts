import { Platform } from 'react-native';

import { accountDirectory, eraseAccountDirectory } from '@/storage/media';

/** What Telegram lists for this app under Active Sessions. */
export const DEVICE = {
  model: Platform.OS === 'ios' ? 'iPhone' : 'Android',
  systemVersion: String(Platform.Version),
};

export const databaseDirectory = (accountId: string) => accountDirectory('tdlib', accountId);
export const eraseDatabase = (accountId: string) => eraseAccountDirectory('tdlib', accountId);
