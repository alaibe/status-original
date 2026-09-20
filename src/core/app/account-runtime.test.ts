import type { LocalAccount } from 'viem';

import { AccountRuntime, type RuntimeAccount } from './account-runtime';
import type { Keyring } from '../identity/keyring';
import { useChatStore } from '../messaging/chat-store';
import { InMemoryChatSession } from '../messaging/in-memory-session';
import { InMemoryMessageStore } from '../messaging/message-store';
import type { ChatMessage } from '../messaging/types';
import { PluginRegistry } from '../plugins/registry';
import type { Plugin, PluginContext, PluginLease } from '../plugins/types';
import { createAccountStorage } from '@/storage/account';
import { PROTOCOLS } from '@/protocols';

const keyring = {
  kind: 'phrase',
  mnemonic: null,
  account: {} as LocalAccount,
  address: '0x0000000000000000000000000000000000000000',
  derive: () => ({ path: '', privateKey: new Uint8Array(), publicKey: new Uint8Array() }),
  deriveEd25519: () => ({ path: '', privateKey: new Uint8Array(), publicKey: new Uint8Array() }),
} as Keyring;

function input(
  accountId: string,
  registry = new PluginRegistry(),
  createSession?: RuntimeAccount['createSession'],
  makeContext: RuntimeAccount['makeContext'] = () => ({} as PluginContext),
): RuntimeAccount {
  return {
    accountId,
    keyring,
    registry,
    defaultEnabled: registry.list().map((plugin) => plugin.manifest.id),
    makeContext,
    createSession: createSession ?? (async () => new InMemoryChatSession()),
    storage: { ...createAccountStorage(accountId), messages: new InMemoryMessageStore() },
  };
}

beforeEach(() => {
  useChatStore.setState({
    status: 'idle',
    sessions: {},
    protocols: {},
    accountId: null,
    accountStorage: null,
    messageStore: null,
    conversations: [],
    messages: {},
    bots: {},
    readAt: {},
  });
});

describe('AccountRuntime', () => {
  it('switches projection before an unfinished old start resolves', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const oldSession = new InMemoryChatSession();
    const newSession = new InMemoryChatSession();
    let finish!: (session: InMemoryChatSession) => void;
    let entered!: () => void;
    const creating = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<InMemoryChatSession>((resolve) => { finish = resolve; });

    const starting = runtime.synchronize(input('account-a', new PluginRegistry(), async () => {
      entered();
      return pending;
    }));
    await creating;
    expect(useChatStore.getState().accountId).toBe('account-a');

    const switching = runtime.synchronize(
      input('account-b', new PluginRegistry(), async () => newSession)
    );
    expect(useChatStore.getState().accountId).toBeNull();
    await switching;

    expect(useChatStore.getState().accountId).toBe('account-b');
    expect(useChatStore.getState().sessions.xmtp).toBe(newSession);

    finish(oldSession);
    await starting;

    expect(oldSession.disconnected).toBe(true);
    expect(useChatStore.getState().accountId).toBe('account-b');
    expect(useChatStore.getState().sessions.xmtp).toBe(newSession);
    await runtime.synchronize(null);
  });

  it('erases without waiting for stale session startup', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const lateSession = new InMemoryChatSession();
    let finish!: (session: InMemoryChatSession) => void;
    let entered!: () => void;
    const creating = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<InMemoryChatSession>((resolve) => { finish = resolve; });
    const starting = runtime.synchronize(input('account-a', new PluginRegistry(), async () => {
      entered();
      return pending;
    }));
    await creating;

    const erasing = runtime.erase({
      id: 'account-a',
      label: 'A',
      address: '0x0000000000000000000000000000000000000001',
      createdAt: 1,
      kind: 'phrase',
    });
    expect(useChatStore.getState().status).toBe('erasing');
    expect(useChatStore.getState().accountId).toBeNull();
    await erasing;

    finish(lateSession);
    await starting;
    expect(lateSession.disconnected).toBe(true);
    expect(useChatStore.getState().accountId).toBeNull();
  });

  it('rejects callbacks retained by an outgoing account stream', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const session = new InMemoryChatSession();
    session.seedConversation({ id: 'old' });
    let staleMessage!: (message: ChatMessage) => void;
    jest.spyOn(session, 'streamMessages').mockImplementation(async (listener) => {
      staleMessage = listener;
      return () => {};
    });

    await runtime.synchronize(input('account-a', new PluginRegistry(), async () => session));
    await runtime.synchronize(input('account-b'));
    staleMessage({
      id: 'late',
      conversationId: 'old',
      senderId: 'them',
      sentAt: 1,
      content: { kind: 'text', text: 'old account' },
      fromMe: false,
      status: 'sent',
    });

    expect(useChatStore.getState().accountId).toBe('account-b');
    expect(useChatStore.getState().messages).toEqual({});
    await runtime.synchronize(null);
  });

  it('disposes a bot whose activation resolves after an account switch', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const dispose = jest.fn();
    let finish!: (dispose: () => void) => void;
    const activated = new Promise<() => void>((resolve) => { finish = resolve; });
    const plugin: Plugin = {
      manifest: {
        id: 'ticker',
        name: 'Ticker',
        description: '',
        version: '1',
        icon: 'ellipse',
        permissions: [],
      },
      setup: () => ({
        bots: [{
          id: 'ticker',
          name: 'Ticker',
          tagline: '',
          greeting: () => [],
          activate: async () => activated,
        }],
      }),
    };

    await runtime.synchronize(input('account-a', new PluginRegistry([plugin])));
    await Promise.resolve();
    const switching = runtime.synchronize(input('account-b'));
    finish(dispose);
    await switching;

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(runtime.runningBotIds()).toEqual([]);
    await runtime.synchronize(null);
  });

  it('revokes plugin leases on deactivate and rejects in-flight work after switch', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const plugin: Plugin = {
      manifest: {
        id: 'leased',
        name: 'Leased',
        description: '',
        version: '1',
        icon: 'ellipse',
        permissions: [],
      },
      setup: () => ({}),
    };
    const registry = new PluginRegistry([plugin]);
    let lease!: PluginLease;
    await runtime.synchronize(input(
      'account-a',
      registry,
      undefined,
      (_plugin, _accountId, _keyring, _storage, activeLease) => {
        lease = activeLease;
        return {} as PluginContext;
      },
    ));

    let finish!: (value: string) => void;
    const work = lease.guard(() => new Promise<string>((resolve) => { finish = resolve; }));
    const switching = runtime.synchronize(input('account-b'));
    finish('old account');

    await expect(work).rejects.toThrow('no longer active');
    await switching;

    await runtime.synchronize(input(
      'account-a',
      registry,
      undefined,
      (_plugin, _accountId, _keyring, _storage, activeLease) => {
        lease = activeLease;
        return {} as PluginContext;
      },
    ));
    await runtime.setPluginEnabled('leased', false);
    expect(() => lease.assertActive()).toThrow('no longer active');
    await runtime.synchronize(null);
  });

  it('serializes a plugin-required session restart', async () => {
    const runtime = new AccountRuntime(PROTOCOLS);
    const first = new InMemoryChatSession();
    const second = new InMemoryChatSession();
    const sessions = [first, second];
    const plugin: Plugin = {
      manifest: {
        id: 'codec',
        name: 'Codec',
        description: '',
        version: '1',
        icon: 'ellipse',
        permissions: [],
        requiresSessionRestart: true,
      },
      setup: () => ({}),
    };

    await runtime.synchronize(input(
      'account-a',
      new PluginRegistry([plugin]),
      async () => sessions.shift()!,
    ));
    await runtime.setPluginEnabled('codec', false);

    expect(first.disconnected).toBe(true);
    expect(useChatStore.getState().sessions.xmtp).toBe(second);
    await runtime.synchronize(null);
  });
});
