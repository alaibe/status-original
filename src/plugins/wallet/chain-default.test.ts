import type { PluginContext } from '@/core/plugins/types';
import type { Widget } from '@/design/widgets';

import { registerChainStrategy, type ChainStrategy } from './chains/strategy';
import { walletCommands } from './commands';
import { defaultChain } from './networks';

jest.mock('./bitcoin/bot', () => ({ checkAddress: jest.fn() }));
jest.mock('./bitcoin', () => ({ bitcoinStrategy: jest.fn() }));
jest.mock('./bitcoin/config', () => ({ hydrateApiBase: jest.fn() }));
jest.mock('./solana', () => ({ solanaStrategy: {} }));
jest.mock('./chains/watcher', () => ({ checkBalances: jest.fn() }));

function chain(id: string, isAddress: (value: string) => boolean): ChainStrategy {
  return {
    id,
    name: id,
    isAddress,
    transfer: { symbol: id === 'bitcoin' ? 'BTC' : 'ETH' },
  } as unknown as ChainStrategy;
}

const evm = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const solana = chain('solana', (v) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v));
const bitcoin = chain('bitcoin', (v) => v.startsWith('bc1'));
const ethereum = chain('ethereum', evm);
const base = chain('base', evm);
const chains = [solana, bitcoin, ethereum, base];
const recipient = '0x0000000000000000000000000000000000000001';

function contextFor(defaultId: string): PluginContext {
  const stored: Record<string, unknown> = {
    networks: chains.map((c) => c.id),
    'active-network': defaultId,
  };
  return {
    storage: { get: async (key: string) => stored[key] ?? null },
  } as unknown as PluginContext;
}

async function openForm(name: string, args: string[], context: PluginContext) {
  let widget: Widget | undefined;
  const result = await walletCommands
    .find((c) => c.name === name)!
    .run({
      args,
      rest: args.join(' '),
      context,
      conversationId: 'local-status',
      respond: async (content) => {
        if (typeof content !== 'string' && content.kind === 'widget') widget = content.widget;
      },
    });
  const form =
    widget?.kind === 'card' ? widget.children.find((child) => child.kind === 'form') : undefined;
  return {
    result,
    selected:
      form?.kind === 'form' ? form.fields.find((field) => field.id === 'chain')?.value : undefined,
  };
}

describe('payment default precedence', () => {
  it('prefers the configured network to Ethereum and registration order', () => {
    expect(defaultChain(chains, undefined, 'base').id).toBe('base');
    expect(defaultChain(chains, recipient, 'base').id).toBe('base');
  });

  it('restricts a configured default to the recipient address family', () => {
    expect(defaultChain(chains, 'bc1qexampleaddress', 'base').id).toBe('bitcoin');
    expect(defaultChain(chains, 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm1GwP', 'base').id).toBe(
      'solana'
    );
    expect(defaultChain(chains, recipient, 'bitcoin').id).toBe('ethereum');
  });

  it('uses the existing fallback when the configured network is unavailable', () => {
    expect(defaultChain(chains, recipient, 'optimism').id).toBe('ethereum');
    expect(defaultChain([bitcoin, solana], undefined, 'base').id).toBe('bitcoin');
    expect(defaultChain(chains).id).toBe('ethereum');
  });

  it('retains the configured default for names without a known address family', () => {
    expect(defaultChain(chains, 'vitalik.eth', 'base').id).toBe('base');
  });
});

describe('payment forms use network preferences', () => {
  let dispose: (() => void)[];

  beforeEach(() => {
    dispose = chains.map(registerChainStrategy);
  });

  afterEach(() => {
    dispose.forEach((remove) => remove());
  });

  it.each(['send', 'request'])('/%s opens on the configured network', async (name) => {
    expect((await openForm(name, [], contextFor('base'))).selected).toBe('base');
  });

  it.each(['send', 'request'])(
    '/%s honors an explicit chain without reading preferences',
    async (name) => {
      const context = {
        storage: {
          get: () => {
            throw new Error('Preferences must not override --chain');
          },
        },
      } as unknown as PluginContext;
      expect((await openForm(name, ['--chain', 'bitcoin'], context)).selected).toBe('bitcoin');
    }
  );

  it.each(['send', 'request'])(
    '/%s rejects a disabled explicit chain instead of falling back',
    async (name) => {
      const { result, selected } = await openForm(
        name,
        ['--chain', 'optimism'],
        contextFor('base')
      );
      expect(result).toEqual({ type: 'error', message: expect.stringContaining('optimism') });
      expect(selected).toBeUndefined();
    }
  );
});
