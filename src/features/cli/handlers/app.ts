import { useIdentityStore } from '@/core/identity/identity-store';
import { useLockStore } from '@/core/identity/lock-store';
import { useChatStore } from '@/core/messaging/chat-store';
import { openChat } from '@/features/navigation/open';

import { readyChat, whenSettled, type CliHandler } from '../context';

export const appHandlers = {
  async status() {
    await whenSettled();
    const lock = useLockStore.getState().status;
    const identity = useIdentityStore.getState();
    const account = identity.accounts.find((a) => a.id === identity.activeAccountId);
    const networks = Object.fromEntries(
      Object.entries(useChatStore.getState().protocols).map(([id, p]) => [
        id,
        { status: p.status, error: p.error ?? undefined, waitingFor: p.login?.step },
      ])
    );
    const data = {
      locked: lock === 'locked',
      identity: identity.status,
      account: account ? { id: account.id, label: account.label, address: account.address } : null,
      networks,
    };
    return {
      data,
      text: [
        lock === 'locked' ? 'Locked' : 'Unlocked',
        account
          ? `Account: ${account.label} (${account.address})`
          : `Account: none (${identity.status})`,
        ...Object.entries(networks).map(
          ([id, n]) =>
            `  ${id}: ${n.status}${n.waitingFor ? ` (waiting for ${n.waitingFor})` : ''}${n.error ? ` — ${n.error}` : ''}`
        ),
      ],
    };
  },

  async open({ args }, { io }) {
    await io.showWindow();
    if (!args.chat) return { data: { opened: true }, text: 'Opened.' };
    const chat = await readyChat(args.chat);
    openChat(chat.id);
    return { data: { opened: true, chat: chat.id }, text: `Opened ${chat.label}.` };
  },
} satisfies Record<string, CliHandler>;
