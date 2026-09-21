import { invoke } from '@tauri-apps/api/core';

/**
 * The operating system's credential store (Keychain on macOS, Credential
 * Manager on Windows, Secret Service on Linux), reached through the Rust side.
 * Desktop has no biometric prompt, so protected items are ordinary items.
 */
export const isSecureStorageAvailable = true;

export function get(key: string): Promise<string | null> {
  return invoke<string | null>('vault_get', { key });
}

export async function set(key: string, value: string): Promise<void> {
  await invoke('vault_set', { key, value });
}

export async function remove(key: string): Promise<void> {
  await invoke('vault_delete', { key });
}

export function getProtected(key: string, _prompt: string): Promise<string | null> {
  return get(key);
}

export function setProtected(key: string, value: string, _prompt: string): Promise<void> {
  return set(key, value);
}

export function removeProtected(key: string): Promise<void> {
  return remove(key);
}
