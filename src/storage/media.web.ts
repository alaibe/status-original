import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export async function eraseMedia(accountId: string): Promise<void> {
  await invoke('media_erase', { accountId });
}

export function accountDirectory(area: string, accountId: string): Promise<string> {
  return invoke('account_dir', { area, accountId });
}

export function eraseAccountDirectory(area: string, accountId: string): Promise<void> {
  return invoke('erase_account_dir', { area, accountId });
}

export function localFileUri(path: string): string {
  return convertFileSrc(path);
}

export { pathOfFileUri } from './file-uri';
