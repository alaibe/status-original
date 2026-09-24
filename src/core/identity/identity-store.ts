import type { Address } from 'viem';
import { create } from 'zustand';

import {
  addressForMnemonic,
  createAccountId,
  loadAccounts,
  loadActiveAccountId,
  saveAccounts,
  setActiveAccountId,
  forgetAccount,
  type AccountRecord,
} from './accounts';
import { deleteMnemonic, readMnemonic } from './key-protection';
import {
  isValidMnemonic,
  keyringFromMnemonic,
  normalizeMnemonic,
  persistAccountMnemonic,
  type Keyring,
} from './keyring';
import { errorMessage } from '../errors';

export type IdentityStatus = 'loading' | 'absent' | 'ready' | 'blocked' | 'invalidated' | 'error';

export interface IdentityState {
  status: IdentityStatus;
  accounts: AccountRecord[];
  activeAccountId: string | null;
  keyring: Keyring | null;
  error: string | null;

  restore(): Promise<void>;
  retryUnlock(): Promise<boolean>;
  adoptIdentity(phrase: string, label?: string): Promise<void>;
  addHardwareAccount(params: { address: Address; vendorId: string; label?: string }): Promise<void>;
  selectAccount(id: string): Promise<void>;
  renameAccount(id: string, label: string): Promise<void>;
  removeErasedAccount(id: string): Promise<void>;
}

let restoring = false;

export const useIdentityStore = create<IdentityState>((set, get) => ({
  status: 'loading',
  accounts: [],
  activeAccountId: null,
  keyring: null,
  error: null,

  async restore() {
    if (restoring) return;
    restoring = true;

    try {
      const [accounts, storedId] = await Promise.all([loadAccounts(), loadActiveAccountId()]);
      if (accounts.length === 0) {
        set({ status: 'absent', accounts: [], activeAccountId: null, keyring: null, error: null });
        return;
      }

      const active = accounts.find((a) => a.id === storedId) ?? accounts[0];
      if (active.id !== storedId) await setActiveAccountId(active.id);

      set({ accounts, error: null });
      await activate(active.id, set);
    } catch (error) {
      set({ status: 'error', error: errorMessage(error) });
    } finally {
      restoring = false;
    }
  },

  async retryUnlock() {
    const id = get().activeAccountId;
    if (!id) return false;
    if (restoring) return false;

    restoring = true;
    try {
      return (await activate(id, set)) === 'ready';
    } finally {
      restoring = false;
    }
  },

  async adoptIdentity(phrase: string, label?: string) {
    const normalized = normalizeMnemonic(phrase);
    if (!isValidMnemonic(normalized)) {
      throw new Error('That recovery phrase is not valid. Check the spelling and word order.');
    }

    const address = addressForMnemonic(normalized);
    const existing = get().accounts;

    const duplicate = existing.find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (duplicate) {
      await deleteMnemonic(duplicate.id);
      await persistAccountMnemonic(duplicate.id, normalized);
      await setActiveAccountId(duplicate.id);
      set({ accounts: existing });
      await activate(duplicate.id, set);
      return;
    }

    const id = createAccountId();
    await persistAccountMnemonic(id, normalized);

    const record: AccountRecord = {
      id,
      label: label?.trim() || `Account ${existing.length + 1}`,
      address,
      createdAt: Date.now(),
      kind: 'phrase',
    };
    const accounts = [...existing, record];
    await saveAccounts(accounts);
    await setActiveAccountId(id);

    set({ accounts });
    await activate(id, set);
  },

  async addHardwareAccount({
    address,
    vendorId,
    label,
  }: {
    address: Address;
    vendorId: string;
    label?: string;
  }) {
    const existing = get().accounts;

    const duplicate = existing.find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (duplicate) {
      await setActiveAccountId(duplicate.id);
      await activate(duplicate.id, set);
      return;
    }

    const id = createAccountId();
    const record: AccountRecord = {
      id,
      label: label?.trim() || `Account ${existing.length + 1}`,
      address,
      createdAt: Date.now(),
      kind: 'hardware',
      vendorId,
    };

    const accounts = [...existing, record];
    await saveAccounts(accounts);
    await setActiveAccountId(id);
    set({ accounts });
  },

  async selectAccount(id: string) {
    if (get().activeAccountId === id) return;
    if (!get().accounts.some((a) => a.id === id)) return;

    await setActiveAccountId(id);
    await activate(id, set);
  },

  async renameAccount(id: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;

    const accounts = get().accounts.map((a) => (a.id === id ? { ...a, label: trimmed } : a));
    await saveAccounts(accounts);
    set({ accounts });
  },

  async removeErasedAccount(id: string) {
    const remaining = await forgetAccount(id);

    if (remaining.length === 0) {
      set({ status: 'absent', accounts: [], activeAccountId: null, keyring: null });
      return;
    }

    set({ accounts: remaining });
    if (get().activeAccountId === id) {
      await activate(remaining[0].id, set);
    }
  },
}));

async function activate(
  accountId: string,
  set: (partial: Partial<IdentityStateSlice>) => void
): Promise<'ready' | 'blocked' | 'invalidated'> {
  const result = await readMnemonic(accountId, true);

  if (result.status !== 'ok') {
    const status = result.status === 'denied' ? 'blocked' : 'invalidated';
    set({ status, activeAccountId: accountId, keyring: null, error: null });
    return status;
  }

  set({
    status: 'ready',
    activeAccountId: accountId,
    keyring: keyringFromMnemonic(result.value),
    error: null,
  });
  return 'ready';
}

type IdentityStateSlice = Pick<
  IdentityState,
  'status' | 'accounts' | 'activeAccountId' | 'keyring' | 'error'
>;
