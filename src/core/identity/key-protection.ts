import {
  accountMnemonicKey,
  VaultKey,
  vaultDelete,
  vaultDeleteProtected,
  vaultGet,
  vaultGetProtected,
  vaultSet,
  vaultSetProtected,
  type ProtectedRead,
} from '@/storage/vault';

const PROMPT = 'Confirm to unlock your account';

export async function isKeyProtectionEnabled(): Promise<boolean> {
  return (await vaultGet(VaultKey.keyProtection)) === '1';
}

export async function readMnemonic(
  accountId: string,
  expectExisting: boolean
): Promise<ProtectedRead> {
  const [sealed, value] = await Promise.all([
    isKeyProtectionEnabled(),
    vaultGet(accountMnemonicKey(accountId)),
  ]);
  if (!sealed) return value === null ? { status: 'absent' } : { status: 'ok', value };
  return vaultGetProtected(accountMnemonicKey(accountId), PROMPT, expectExisting);
}

export async function writeMnemonic(accountId: string, phrase: string): Promise<void> {
  if (await isKeyProtectionEnabled()) {
    await vaultSetProtected(accountMnemonicKey(accountId), phrase);
    return;
  }
  await vaultSet(accountMnemonicKey(accountId), phrase);
}

export async function deleteMnemonic(accountId: string): Promise<void> {
  await vaultDelete(accountMnemonicKey(accountId));
  await vaultDeleteProtected(accountMnemonicKey(accountId)).catch(() => {});
}

export type ProtectionChange = { ok: true } | { ok: false; reason: 'denied' | 'unreadable' };

export async function enableKeyProtection(accountIds: string[]): Promise<ProtectionChange> {
  const moved: string[] = [];

  for (const id of accountIds) {
    const plain = await vaultGet(accountMnemonicKey(id));
    if (plain === null) {
      const sealed = await vaultGetProtected(accountMnemonicKey(id), PROMPT, true);
      if (sealed.status === 'ok') continue;
      return { ok: false, reason: sealed.status === 'denied' ? 'denied' : 'unreadable' };
    }

    await vaultSetProtected(accountMnemonicKey(id), plain);
    moved.push(id);
  }

  for (const id of moved) await vaultDelete(accountMnemonicKey(id));
  await vaultSet(VaultKey.keyProtection, '1');
  return { ok: true };
}

export async function disableKeyProtection(accountIds: string[]): Promise<ProtectionChange> {
  const recovered: [string, string][] = [];

  for (const id of accountIds) {
    const sealed = await vaultGetProtected(accountMnemonicKey(id), PROMPT, true);

    if (sealed.status === 'ok') {
      recovered.push([id, sealed.value]);
      continue;
    }
    if (sealed.status === 'denied') return { ok: false, reason: 'denied' };
    if (sealed.status === 'invalidated') return { ok: false, reason: 'unreadable' };
  }

  for (const [id, phrase] of recovered) await vaultSet(accountMnemonicKey(id), phrase);
  for (const [id] of recovered) await vaultDeleteProtected(accountMnemonicKey(id)).catch(() => {});

  await vaultDelete(VaultKey.keyProtection);
  return { ok: true };
}
