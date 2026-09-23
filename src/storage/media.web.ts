import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { pathOfFileUri as filePath } from './file-uri';

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

const ASSET_URL = /^(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\//;

/** Media the window shows through Tauri's asset protocol is still a file on disk. */
export function pathOfFileUri(uri: string): string {
  return ASSET_URL.test(uri) ? decodeURIComponent(uri.replace(ASSET_URL, '')) : filePath(uri);
}
