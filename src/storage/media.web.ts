import { invoke } from '@tauri-apps/api/core';

export async function eraseMedia(accountId: string): Promise<void> {
  await invoke('media_erase', { accountId });
}
