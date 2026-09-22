import type { PluginContext } from '@/core/plugins/types';
import type { Widget, WidgetRow } from '@/design/widgets';

import { registerChainStrategy, type ChainStrategy, type Holding } from './chains/strategy';
import { walletCommands } from './commands';

jest.mock('./bitcoin/bot', () => ({ checkAddress: jest.fn() }));
jest.mock('./bitcoin', () => ({ bitcoinStrategy: jest.fn() }));
jest.mock('./bitcoin/config', () => ({ hydrateApiBase: jest.fn() }));
jest.mock('./solana', () => ({ solanaStrategy: {} }));
jest.mock('./chains/watcher', () => ({ checkBalances: jest.fn() }));

const me = '0x0000000000000000000000000000000000000002';

function chain(
  id: string,
  symbol: string,
  amount: string | null,
  holdings?: Holding[] | Error
): ChainStrategy {
  return {
    id,
    name: id,
    icon: 'wallet-outline',
    isAddress: () => true,
    selfAddress: () => me,
    balance: async () => {
      if (amount === null) throw new Error('endpoint down');
      return amount;
    },
    holdings: holdings
      ? async () => {
          if (holdings instanceof Error) throw holdings;
          return holdings;
        }
      : undefined,
    transfer: { symbol },
    explorer: { name: id, addressUrl: () => '' },
  } as unknown as ChainStrategy;
}

const context = {
  storage: { get: async () => null },
} as unknown as PluginContext;

const disposers: (() => void)[] = [];

function register(...chains: ChainStrategy[]) {
  for (const c of chains) disposers.push(registerChainStrategy(c));
}

afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

async function overview(): Promise<WidgetRow[]> {
  let widget: Widget | undefined;
  await walletCommands
    .find((c) => c.name === 'balance')!
    .run({
      args: [],
      rest: '',
      context,
      conversationId: 'local-status',
      respond: async (content) => {
        if (typeof content !== 'string' && content.kind === 'widget') widget = content.widget;
      },
    });
  const rows = widget?.kind === 'card' ? widget.children.find((c) => c.kind === 'rows') : undefined;
  return rows?.kind === 'rows' ? rows.rows : [];
}

describe('/balance with no argument', () => {
  it('lists the tokens a network holds under its coin', async () => {
    register(
      chain('ethereum', 'ETH', '1.5', [
        { symbol: 'USDC', amount: '250', id: '0xa0b8' },
        { symbol: 'DAI', amount: '12.5', id: '0x6b17' },
      ])
    );

    const rows = await overview();

    expect(rows.map((row) => row.label.trim())).toEqual(['ethereum', 'USDC', 'DAI']);
    expect(rows[1].value).toBe('250');
    // Indented, so a token reads as belonging to the network above it.
    expect(rows[1].label.startsWith(' ')).toBe(true);
  });

  it('offers to send a token it can name a contract for', async () => {
    register(chain('base', 'ETH', '0.2', [{ symbol: 'USDC', amount: '5', id: '0x8335' }]));

    const [, token] = await overview();
    expect(token.actions?.[0]).toEqual(
      expect.objectContaining({
        command: expect.stringContaining('--token 0x8335'),
      })
    );
  });

  it('leaves a token alone when the chain cannot send it', async () => {
    // Solana reports what it holds long before it can spend it.
    register(chain('solana', 'SOL', '3', [{ symbol: 'USDC', amount: '9' }]));

    const [, token] = await overview();
    expect(token.actions).toBeUndefined();
  });

  it('still shows the coin when the token read fails', async () => {
    register(chain('ethereum', 'ETH', '1.5', new Error('rpc refused')));

    const rows = await overview();
    expect(rows.map((row) => row.label.trim())).toEqual(['ethereum']);
    expect(rows[0].value).toBe('1.5 ETH');
  });

  it('says a network is unavailable rather than claiming nothing is held', async () => {
    register(chain('ethereum', 'ETH', null, [{ symbol: 'USDC', amount: '250' }]));

    const rows = await overview();
    expect(rows[0].value).toBe('unavailable');
    expect(rows).toHaveLength(1);
  });
});
