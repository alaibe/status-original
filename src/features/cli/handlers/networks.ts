import { useIdentityStore } from '@/core/identity/identity-store';
import { useChatStore, xmtpSessionFor } from '@/core/messaging/chat-store';
import { loadProtocolConfig, missingFields, withDefaults } from '@/core/messaging/config';
import type { LoginState } from '@/core/messaging/protocol';
import { isConfigured } from '@/core/messaging/registry';
import { protocolById, transportProtocols } from '@/protocols';
import { accountRuntime } from '@/runtime';

import { approveOrThrow, waitFor, whenAccountReady, type CliHandler, type CliIo } from '../context';
import { CliError } from '../errors';

const STEP_LABEL: Record<LoginState['step'], string> = {
  phone: 'Phone number',
  code: 'Code',
  password: 'Password',
};

export function findNetwork(id: string) {
  const descriptor = protocolById(id.toLowerCase());
  if (!descriptor?.connect) {
    const known = transportProtocols()
      .map((p) => p.id)
      .join(', ');
    throw new CliError(`No network "${id}". Known: ${known}.`, 'notFound');
  }
  return descriptor;
}

function sessionOf(id: string) {
  const session = useChatStore.getState().sessions[id];
  if (!session) {
    throw new CliError(
      `${protocolById(id)?.label ?? id} is not connected. Check status-original networks config ${id}.`,
      'unavailable'
    );
  }
  return session;
}

function loginOf(id: string): LoginState | null {
  return useChatStore.getState().protocols[id]?.login ?? null;
}

function describeLogin(label: string, login: LoginState | null) {
  if (!login) return { data: { signedIn: true, step: null }, text: `Signed in to ${label}.` };
  return {
    data: { signedIn: false, step: login.step, hint: login.hint, error: login.error },
    text: [
      login.title ?? `${label} is waiting for: ${STEP_LABEL[login.step].toLowerCase()}`,
      ...(login.hint ? [login.hint] : []),
      ...(login.error ? [`Error: ${login.error}`] : []),
    ],
  };
}

async function submitLogin(id: string, answer: string): Promise<void> {
  const session = sessionOf(id);
  const before = loginOf(id);
  await session.submitLogin!(answer);
  await waitFor(useChatStore, (s) => (s.protocols[id]?.login ?? null) !== before, 60_000);
}

async function interactiveLogin(id: string, label: string, io: CliIo) {
  for (let login = loginOf(id); login; login = loginOf(id)) {
    if (login.title) io.warn(login.title);
    if (login.hint) io.warn(login.hint);
    if (login.error) io.warn(`Error: ${login.error}`);
    const answer = await io.prompt(`${STEP_LABEL[login.step]}: `, login.step === 'password');
    if (!answer.trim()) throw new CliError('Sign-in cancelled.');
    await submitLogin(id, answer);
  }
  return describeLogin(label, null);
}

export const networkHandlers = {
  async networks() {
    await whenAccountReady();
    const accountId = useIdentityStore.getState().activeAccountId!;
    const { protocols } = useChatStore.getState();
    const data = await Promise.all(
      transportProtocols().map(async (p) => {
        const connection = protocols[p.id];
        const config = await loadProtocolConfig(accountId, p.id);
        return {
          id: p.id,
          name: p.label,
          configured: isConfigured(p, withDefaults(p.configSchema, config)),
          status: connection?.status ?? 'off',
          error: connection?.error ?? undefined,
          waitingFor: connection?.login?.step,
        };
      })
    );
    return {
      data,
      text: data.map(
        (n) =>
          `${n.id.padEnd(10)} ${n.name.padEnd(12)} ${n.configured ? n.status : 'not set up'}` +
          (n.waitingFor ? ` (waiting for ${n.waitingFor})` : '') +
          (n.error ? ` — ${n.error}` : '')
      ),
    };
  },

  async 'networks config'({ args, rest }, { io }) {
    await whenAccountReady();
    const descriptor = findNetwork(args.network!);
    const accountId = useIdentityStore.getState().activeAccountId!;
    const config = withDefaults(
      descriptor.configSchema,
      await loadProtocolConfig(accountId, descriptor.id)
    );
    const fields = descriptor.configSchema.fields;

    if (rest.length === 0) {
      const data = fields.map((f) => ({
        key: f.key,
        label: f.label,
        kind: f.kind,
        required: Boolean(f.required),
        value: f.kind === 'secret' ? undefined : config[f.key],
        set: Boolean(config[f.key]),
        help: f.help,
      }));
      return {
        data,
        text: data.length
          ? data.map(
              (f) =>
                `${f.key}${f.required ? '*' : ''} = ${f.kind === 'secret' ? (f.set ? '(set)' : '') : (f.value ?? '')}` +
                `   ${f.label}`
            )
          : `${descriptor.label} has no settings.`,
      };
    }

    const next = { ...config };
    for (const pair of rest) {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const field = fields.find((f) => f.key === key);
      if (!field) {
        throw new CliError(
          `${descriptor.label} has no setting "${key}". Settings: ${fields.map((f) => f.key).join(', ')}.`,
          'usage'
        );
      }
      next[key] =
        eq === -1
          ? await io.prompt(`${field.label}: `, field.kind === 'secret')
          : pair.slice(eq + 1).replace(/\\n/g, '\n');
    }
    const missing = missingFields(descriptor.configSchema, next);
    await accountRuntime.updateProtocolConfig(accountId, descriptor.id, next);
    return {
      data: { network: descriptor.id, saved: true, missing: missing.map((f) => f.key) },
      text: missing.length
        ? `Saved. Still needed: ${missing.map((f) => f.key).join(', ')}.`
        : `Saved. ${descriptor.label} is reconnecting.`,
    };
  },

  async 'networks login'({ args }, { io }) {
    await whenAccountReady();
    const descriptor = findNetwork(args.network!);
    const session = sessionOf(descriptor.id);
    if (!session.subscribeLogin || !session.submitLogin) {
      throw new CliError(
        `${descriptor.label} does not sign in step by step. Use status-original networks config ${descriptor.id}.`,
        'unsupported'
      );
    }
    if (args.answer !== undefined) {
      if (!loginOf(descriptor.id)) return describeLogin(descriptor.label, null);
      await submitLogin(descriptor.id, args.answer);
      return describeLogin(descriptor.label, loginOf(descriptor.id));
    }
    if (!io.stdinTty) return describeLogin(descriptor.label, loginOf(descriptor.id));
    return interactiveLogin(descriptor.id, descriptor.label, io);
  },

  async 'networks logout'({ args }, { io }) {
    await whenAccountReady();
    const descriptor = findNetwork(args.network!);
    const session = sessionOf(descriptor.id);
    if (!session.signOut) throw new CliError(`${descriptor.label} has no sign-out.`, 'unsupported');
    await approveOrThrow(io, `Sign out of ${descriptor.label}?`);
    await session.signOut();
    return {
      data: { network: descriptor.id, signedOut: true },
      text: `Signed out of ${descriptor.label}.`,
    };
  },

  async 'networks sync'({ args }) {
    await whenAccountReady();
    const store = useChatStore.getState();
    if (args.network) await store.syncProtocol(findNetwork(args.network).id);
    else await store.sync();
    return { data: { synced: args.network ?? 'all' }, text: 'Up to date.' };
  },

  async devices() {
    await whenAccountReady();
    const xmtp = xmtpSessionFor(useChatStore.getState());
    if (!xmtp?.listInstallations) throw new CliError('XMTP is not connected.', 'unavailable');
    const installations = await xmtp.listInstallations();
    return {
      data: installations,
      text: installations.map(
        (i) =>
          `${i.current ? '*' : ' '} ${i.id}` +
          (i.createdAt ? `  ${new Date(i.createdAt).toLocaleDateString()}` : '') +
          (i.current ? '  (this device)' : '')
      ),
    };
  },

  async 'devices revoke'({ rest }, { io }) {
    await whenAccountReady();
    const xmtp = xmtpSessionFor(useChatStore.getState());
    if (!xmtp?.listInstallations || !xmtp.revokeInstallations) {
      throw new CliError('XMTP is not connected.', 'unavailable');
    }
    const current = (await xmtp.listInstallations()).find((i) => i.current)?.id;
    if (current && rest.includes(current)) {
      throw new CliError('That is this device. Revoke the others instead.', 'usage');
    }
    await approveOrThrow(io, `Revoke ${rest.length} XMTP installation(s)?\n${rest.join('\n')}`);
    await xmtp.revokeInstallations(rest);
    return { data: { revoked: rest }, text: `Revoked ${rest.length} installation(s).` };
  },
} satisfies Record<string, CliHandler>;
