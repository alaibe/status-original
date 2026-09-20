import { accountCredentialsKey, vaultDelete, vaultGet, vaultSet } from '@/storage/vault';

export type CredentialId = 'gifs' | 'tokens';

export async function readCredential(
  accountId: string,
  id: CredentialId
): Promise<string | null> {
  const raw = await vaultGet(accountCredentialsKey(accountId));
  if (!raw) return null;
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[id];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function writeCredential(
  accountId: string,
  id: CredentialId,
  value: string
): Promise<void> {
  const entry = accountCredentialsKey(accountId);
  const trimmed = value.trim();
  const raw = await vaultGet(entry);
  let credentials: Partial<Record<CredentialId, string>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      credentials = parsed as Partial<Record<CredentialId, string>>;
    }
  } catch {}

  if (trimmed) credentials[id] = trimmed;
  else delete credentials[id];

  if (Object.keys(credentials).length === 0) await vaultDelete(entry);
  else await vaultSet(entry, JSON.stringify(credentials));
}
