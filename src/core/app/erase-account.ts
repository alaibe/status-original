import { useIdentityStore } from '../identity/identity-store';
import { vaultWipe } from '@/storage/vault';
import { accountRuntime } from '@/runtime';

export async function eraseAccount(accountId?: string): Promise<void> {
  const identity = useIdentityStore.getState();
  const targetId = accountId ?? identity.activeAccountId;
  if (!targetId) return;

  const account = identity.accounts.find((candidate) => candidate.id === targetId);
  if (!account) throw new Error(`Account ${targetId} does not exist.`);

  await accountRuntime.erase(account);
  await useIdentityStore.getState().removeErasedAccount(targetId);
}

export async function eraseAllAccounts(): Promise<void> {
  const identity = useIdentityStore.getState();
  const ids = identity.accounts.map((account) => account.id);
  const ordered = ids.filter((id) => id !== identity.activeAccountId);
  if (identity.activeAccountId) ordered.push(identity.activeAccountId);

  for (const id of ordered) await eraseAccount(id);
  await vaultWipe();
}
