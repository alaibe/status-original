import { accountDirectory, eraseAccountDirectory } from '@/storage/media';

// TDLib fills in the system version itself when it is left empty.
export const DEVICE = { model: 'Mac', systemVersion: '' };

export const databaseDirectory = (accountId: string) => accountDirectory('tdlib', accountId);
export const eraseDatabase = (accountId: string) => eraseAccountDirectory('tdlib', accountId);
