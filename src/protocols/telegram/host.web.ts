import { convertFileSrc, invoke } from '@tauri-apps/api/core';

// TDLib fills in the system version itself when it is left empty.
export const DEVICE = { model: 'Mac', systemVersion: '' };

export function databaseDirectory(accountId: string): Promise<string> {
  return invoke('td_database_directory', { accountId });
}

export function eraseDatabase(accountId: string): Promise<void> {
  return invoke('td_erase', { accountId });
}

export function localFileUri(path: string): string {
  return convertFileSrc(path);
}
