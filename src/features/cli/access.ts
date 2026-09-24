import { VaultKey, vaultDelete, vaultGet, vaultSet } from '@/storage/vault';

export async function isCliAllowed(): Promise<boolean> {
  return (await vaultGet(VaultKey.commandLine)) === '1';
}

export function setCliAllowed(allowed: boolean): Promise<void> {
  return allowed ? vaultSet(VaultKey.commandLine, '1') : vaultDelete(VaultKey.commandLine);
}
