import AsyncStorage from '@react-native-async-storage/async-storage';

import { useIdentityStore } from '@/core/identity/identity-store';
import { useLockStore } from '@/core/identity/lock-store';
import { useChatStore } from '@/core/messaging/chat-store';
import { InMemoryChatSession } from '@/core/messaging/in-memory-session';
import { connectFake, disconnectFake, ns, resetChatStore } from '@/core/messaging/testing/store';
import type { PluginHostValue } from '@/core/plugins/host';
import { PluginRegistry } from '@/core/plugins/registry';
import type { Plugin } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { setCliAllowed } from './access';
import type { CliIo } from './context';
import { COMMANDS } from './commands';
import { runCli } from './run';

jest.mock('@/core/identity/keyring', () => ({
  ...jest.requireActual('@/core/identity/keyring'),
  loadOrCreateDbEncryptionKey: async () => new Uint8Array(32),
}));

jest.mock('@/features/navigation/open', () => ({ openChat: jest.fn() }));

interface FakeIo extends CliIo {
  out: string[];
  err: string[];
  approvals: string[];
  answer: boolean;
}

function fakeIo(stdin = ''): FakeIo {
  const io: FakeIo = {
    json: false,
    tty: false,
    stdinTty: stdin === '',
    out: [],
    err: [],
    approvals: [],
    answer: true,
    print: (text) => void io.out.push(text),
    warn: (text) => void io.err.push(text),
    prompt: async () => {
      throw new Error('no terminal');
    },
    stdin: async () => new TextEncoder().encode(stdin),
    readFile: async (path) => new TextEncoder().encode(`contents of ${path}`),
    writeFile: async () => {},
    approve: async (request) => {
      io.approvals.push(request);
      return io.answer;
    },
    showWindow: async () => {},
    closed: new Promise(() => {}),
  };
  return io;
}

const PEER = 'b'.repeat(64);

function host(plugins: Plugin[] = []): PluginHostValue {
  const registry = new PluginRegistry(plugins);
  return { registry } as unknown as PluginHostValue;
}

async function run(argv: string[], io = fakeIo(), plugins?: PluginRegistry) {
  const env = {
    io,
    host: plugins ? ({ registry: plugins } as unknown as PluginHostValue) : host(),
  };
  const code = await runCli(argv, env);
  return { code, io, out: io.out.join('\n'), err: io.err.join('\n') };
}

let session: InMemoryChatSession;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetChatStore();
  session = new InMemoryChatSession();
  session.seedConversation({ id: 'alice', title: 'Alice' });
  session.seedAddress(PEER, '0x2222222222222222222222222222222222222222');
  session.seedConversation({ id: 'team', title: 'Team chat', kind: 'group', selfRole: 'owner' });
  session.seedConversation({
    id: 'teammate',
    title: 'Team lead',
    memberIds: [session.self.participantId, 'c'.repeat(64)],
  });
  session.deliver('alice', { id: 'm1', content: { kind: 'text', text: 'lunch?' }, sentAt: 3_000 });
  await connectFake(session);
  useLockStore.setState({ status: 'open' });
  await setCliAllowed(true);
  useIdentityStore.setState({
    status: 'ready',
    activeAccountId: 'test-account',
    accounts: [
      {
        id: 'test-account',
        label: 'Main',
        address: '0x1111111111111111111111111111111111111111',
        createdAt: 1,
        kind: 'phrase',
      },
    ],
  });
});

afterEach(() => disconnectFake());

describe('reading', () => {
  it('lists chats as JSON', async () => {
    const { code, out } = await run(['chats', '--json']);

    expect(code).toBe(0);
    const chats = JSON.parse(out);
    expect(chats.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining([ns('alice'), ns('team')])
    );
    expect(chats.find((c: { id: string }) => c.id === ns('alice'))).toMatchObject({
      title: '0x2222…2222',
      peer: PEER,
      kind: 'dm',
      lastMessage: 'lunch?',
    });
  });

  it('finds a direct message by the other person’s address', async () => {
    const { code, out } = await run(['read', '0x2222222222222222222222222222222222222222']);

    expect(code).toBe(0);
    expect(out).toContain('lunch?');
  });

  it('prints a chat’s messages with their ids', async () => {
    const { code, out } = await run(['read', 'alice']);

    expect(code).toBe(0);
    expect(out).toContain('lunch?');
    expect(out).toContain('[m1]');
  });

  it('refuses an ambiguous title and lists the candidates', async () => {
    const { code, err } = await run(['read', 'team']);

    expect(code).toBe(3);
    expect(err).toContain(ns('team'));
    expect(err).toContain(ns('teammate'));
  });

  it('prefers the chat whose whole title matches', async () => {
    const { code } = await run(['read', 'team chat']);

    expect(code).toBe(0);
  });
});

describe('sending', () => {
  it('sends the text given', async () => {
    const { code } = await run(['send', 'alice', 'on', 'my', 'way']);

    expect(code).toBe(0);
    expect(session.sent).toEqual([
      { conversationId: 'alice', content: { kind: 'text', text: 'on my way' } },
    ]);
  });

  it('reads the text from stdin when it is piped', async () => {
    const { code } = await run(['send', 'alice', '-'], fakeIo('from a pipe\n'));

    expect(code).toBe(0);
    expect(session.sent[0].content).toEqual({ kind: 'text', text: 'from a pipe' });
  });

  it('says what is missing instead of sending nothing', async () => {
    const { code, err } = await run(['send', 'alice']);

    expect(code).toBe(2);
    expect(err).toContain('Nothing to send');
    expect(session.sent).toEqual([]);
  });

  it('reports errors as JSON on stderr under --json', async () => {
    const { code, err, out } = await run(['send', 'nobody', 'hi', '--json']);

    expect(code).toBe(3);
    expect(out).toBe('');
    expect(JSON.parse(err)).toEqual({ error: 'No chat matches "nobody".', code: 3 });
  });
});

describe('approval', () => {
  const wallet: Plugin = {
    manifest: {
      id: 'pay',
      name: 'Pay',
      description: '',
      version: '1',
      icon: 'wallet-outline',
      permissions: [],
    },
    setup: () => ({
      bots: [{ id: 'pay', name: 'Pay', tagline: '', greeting: () => [] }],
      commands: [
        {
          name: 'pay',
          description: 'Pay someone',
          usage: '/pay <amount>',
          async run({ args, respond }) {
            if (!args.includes('--confirm')) {
              await respond({
                kind: 'widget',
                widget: W.actions([
                  { label: 'Confirm', command: `/pay ${args[0]} --confirm` },
                  { label: 'Other amount', command: '/draft /pay ' },
                ]),
                fallback: 'Review',
              });
              return { type: 'handled' };
            }
            return { type: 'notice', message: 'Paid' };
          },
        },
      ],
    }),
  };

  async function registryWith(plugin: Plugin) {
    const registry = new PluginRegistry([plugin]);
    await registry.activate(plugin.manifest.id, () => ({}) as never);
    return registry;
  }

  it('turns buttons into the commands they would run', async () => {
    const { code, out, io } = await run(['run', '/pay', '5'], fakeIo(), await registryWith(wallet));

    expect(code).toBe(0);
    expect(out).toContain('Confirm: status-original run /pay 5 --confirm');
    expect(out).toContain('Other amount: status-original run /pay  (fill in the rest)');
    expect(io.approvals).toEqual([]);
  });

  it('asks the person at the app before anything confirms', async () => {
    const { code, out, io } = await run(
      ['run', '/pay', '5', '--confirm'],
      fakeIo(),
      await registryWith(wallet)
    );

    expect(code).toBe(0);
    expect(io.approvals).toHaveLength(1);
    expect(io.approvals[0]).toContain('/pay 5 --confirm');
    expect(out).toContain('Paid');
  });

  it('stops with exit 5 when the person declines', async () => {
    const io = fakeIo();
    io.answer = false;
    const { code, out } = await run(
      ['run', '/pay', '5', '--confirm'],
      io,
      await registryWith(wallet)
    );

    expect(code).toBe(5);
    expect(out).not.toContain('Paid');
  });
});

describe('every command that asks first', () => {
  const plugin: Plugin = {
    manifest: {
      id: 'pay',
      name: 'Pay',
      description: '',
      version: '1',
      icon: 'wallet-outline',
      permissions: [],
    },
    setup: () => ({}),
  };
  const setEnabled = jest.fn();
  const signOut = jest.fn();
  const revokeInstallations = jest.fn();

  type Asking = Extract<(typeof COMMANDS)[number], { approval: true }>['path'];
  const cases: Record<Asking, { argv: string[]; untouched: () => void }> = {
    'accounts erase': {
      argv: ['accounts', 'erase', 'Main'],
      untouched: () => expect(useIdentityStore.getState().accounts).toHaveLength(1),
    },
    'networks logout': {
      argv: ['networks', 'logout', 'xmtp'],
      untouched: () => expect(signOut).not.toHaveBeenCalled(),
    },
    'devices revoke': {
      argv: ['devices', 'revoke', 'old'],
      untouched: () => expect(revokeInstallations).not.toHaveBeenCalled(),
    },
    'plugins enable': {
      argv: ['plugins', 'enable', 'pay'],
      untouched: () => expect(setEnabled).not.toHaveBeenCalled(),
    },
  };

  it.each(Object.entries(cases))('%s stops with exit 5 when declined', async (_, c) => {
    Object.assign(session, {
      signOut,
      revokeInstallations,
      listInstallations: async () => [{ id: 'here', current: true }],
    });
    const io = fakeIo();
    io.answer = false;
    const env = {
      io,
      host: { registry: new PluginRegistry([plugin]), setEnabled } as unknown as PluginHostValue,
    };

    const code = await runCli(c.argv, env);

    expect(io.approvals).toHaveLength(1);
    expect(code).toBe(5);
    c.untouched();
  });
});

it('names people the way your plugins do', async () => {
  const naming: Plugin = {
    manifest: {
      id: 'namer',
      name: 'Namer',
      description: '',
      version: '1',
      icon: 'people-outline',
      permissions: [],
    },
    setup: () => ({ names: async () => ({ [PEER]: 'Weather bot' }) }),
  };
  const registry = new PluginRegistry([naming]);
  await registry.activate('namer', () => ({}) as never);

  const { code, out } = await run(['read', 'weather bot'], fakeIo(), registry);

  expect(code).toBe(0);
  expect(out).toContain('lunch?');
});

it('does nothing until the command line is turned on in the app', async () => {
  await setCliAllowed(false);

  const { code, err } = await run(['send', 'alice', 'hi']);

  expect(code).toBe(4);
  expect(err).toContain('Settings › Command line');
  expect(session.sent).toEqual([]);
});

describe('locked app', () => {
  it('exits 4 without touching the account', async () => {
    useLockStore.setState({ status: 'locked' });

    const { code, err } = await run(['chats']);

    expect(code).toBe(4);
    expect(err).toContain('locked');
  });
});

it('keeps chat state readable after a mark-read', async () => {
  const { code } = await run(['mark-read', 'alice']);

  expect(code).toBe(0);
  expect(useChatStore.getState().readAt[ns('alice')]).toBeGreaterThan(0);
});

it('streams each new message once, however many places it lands in', async () => {
  let stop!: () => void;
  const io = fakeIo();
  io.closed = new Promise((resolve) => {
    stop = resolve;
  });
  const watching = run(['watch', '--json'], io);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const message = {
    id: 'm2',
    conversationId: ns('alice'),
    senderId: PEER,
    sentAt: Date.now(),
    content: { kind: 'text' as const, text: 'are you there?' },
    fromMe: false,
    status: 'sent' as const,
  };
  useChatStore.setState((s) => ({
    messages: { ...s.messages, [ns('alice')]: [...(s.messages[ns('alice')] ?? []), message] },
    conversations: s.conversations.map((c) =>
      c.id === ns('alice')
        ? { ...c, lastMessage: { ...message, id: 'preview:m2', preview: true } }
        : c.id === ns('team')
          ? { ...c, lastMessage: { ...message, id: 'm3', conversationId: ns('team') } }
          : c
    ),
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  stop();
  const { code } = await watching;

  expect(code).toBe(0);
  expect(io.out.map((line) => JSON.parse(line).id)).toEqual(['m2', 'm3']);
});
