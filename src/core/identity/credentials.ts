import { accountCredentialsKey, vaultDelete, vaultGet, vaultSet } from '@/storage/vault';

export type CredentialId = 'gifs' | 'tokens';

export type Credentials = Partial<Record<CredentialId, string>>;

/** Every optional key of the account in one read; they share a vault entry. */
export async function readCredentials(accountId: string): Promise<Credentials> {
  const raw = await vaultGet(accountCredentialsKey(accountId));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string')
    ) as Credentials;
  } catch {
    return {};
  }
}

export async function readCredential(
  accountId: string,
  id: CredentialId
): Promise<string | null> {
  return (await readCredentials(accountId))[id] ?? null;
}

export async function writeCredential(
  accountId: string,
  id: CredentialId,
  value: string
): Promise<void> {
  const entry = accountCredentialsKey(accountId);
  const trimmed = value.trim();
  const credentials = await readCredentials(accountId);

  if (trimmed) credentials[id] = trimmed;
  else delete credentials[id];

  if (Object.keys(credentials).length === 0) await vaultDelete(entry);
  else await vaultSet(entry, JSON.stringify(credentials));
}
