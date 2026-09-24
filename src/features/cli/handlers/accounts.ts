import { router } from 'expo-router';

import { eraseAccount } from '@/core/app/erase-account';
import { useIdentityStore } from '@/core/identity/identity-store';
import { createMnemonic } from '@/core/identity/keyring';
import { useChatStore } from '@/core/messaging/chat-store';

import {
  approveOrThrow,
  findAccount,
  whenAccountReady,
  whenUnlocked,
  type CliHandler,
} from '../context';
import { CliError } from '../errors';
import { readText } from './input';

function activeAccount() {
  const { accounts, activeAccountId } = useIdentityStore.getState();
  return accounts.find((a) => a.id === activeAccountId);
}

export const accountHandlers = {
  async accounts() {
    await whenUnlocked();
    const { accounts, activeAccountId } = useIdentityStore.getState();
    const data = accounts.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      kind: a.kind,
      active: a.id === activeAccountId,
    }));
    return {
      data,
      text: data.length
        ? data.map((a) => `${a.active ? '*' : ' '} ${a.label}  ${a.address}  ${a.kind}  ${a.id}`)
        : 'No accounts yet. Run status-original accounts create, or accounts import.',
    };
  },

  async 'accounts use'({ args }) {
    await whenUnlocked();
    const account = findAccount(args.account!);
    await useIdentityStore.getState().selectAccount(account.id);
    await whenAccountReady();
    return { data: { id: account.id }, text: `Now using ${account.label}.` };
  },

  async 'accounts rename'({ args }) {
    await whenUnlocked();
    const account = findAccount(args.account!);
    await useIdentityStore.getState().renameAccount(account.id, args.label!);
    return { data: { id: account.id, label: args.label }, text: `Renamed to ${args.label}.` };
  },

  async 'accounts create'({ flags }) {
    await whenUnlocked();
    await useIdentityStore.getState().adoptIdentity(createMnemonic(), label(flags.label));
    const account = activeAccount()!;
    return {
      data: { id: account.id, label: account.label, address: account.address },
      text: [
        `Created ${account.label} (${account.address}).`,
        'Write down its recovery phrase in the app: Settings › Identity. The command line never shows it.',
      ],
    };
  },

  async 'accounts import'({ flags }, { io }) {
    await whenUnlocked();
    const phrase = await readText(io, 'Recovery phrase: ', true);
    if (!phrase.trim()) throw new CliError('No recovery phrase given.', 'usage');
    await useIdentityStore.getState().adoptIdentity(phrase, label(flags.label));
    const account = activeAccount()!;
    return {
      data: { id: account.id, label: account.label, address: account.address },
      text: `Imported ${account.label} (${account.address}).`,
    };
  },

  async 'accounts erase'({ args }, { io }) {
    await whenUnlocked();
    const account = findAccount(args.account!);
    await approveOrThrow(
      io,
      `Erase ${account.label} (${account.address}) from this device?\nWithout its recovery phrase it cannot be restored.`
    );
    await eraseAccount(account.id);
    router.replace(
      useIdentityStore.getState().accounts.length ? '/chats' : '/(onboarding)/welcome'
    );
    return { data: { id: account.id, erased: true }, text: `Erased ${account.label}.` };
  },

  async whoami() {
    await whenAccountReady();
    const account = activeAccount()!;
    const networks = Object.entries(useChatStore.getState().sessions).map(([id, session]) => ({
      network: id,
      id: session.self.participantId,
      address: session.self.address,
    }));
    return {
      data: { id: account.id, label: account.label, address: account.address, networks },
      text: [
        `${account.label}  ${account.address}`,
        ...networks.map(
          (n) =>
            `  ${n.network}: ${n.id}${n.address && n.address !== n.id ? ` (${n.address})` : ''}`
        ),
      ],
    };
  },
} satisfies Record<string, CliHandler>;

function label(value: string | true | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
