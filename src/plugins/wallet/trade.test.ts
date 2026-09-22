import type { PluginContext } from '@/core/plugins/types';
import type { Widget } from '@/design/widgets';
import { publicClientFor } from '@/lib/evm/chains';
import { walletClientFor } from '@/lib/evm/wallet';
import { LIFI_NATIVE, LifiError, lifiQuote, lifiStatus, lifiToken, type LifiQuote, type LifiToken } from '@/lib/lifi';

import { EVM_CHAINS, evmStrategy } from './chains/evm';
import { registerChainStrategy } from './chains/strategy';
import { tradeCommand } from './trade';

jest.mock('./bitcoin/bot', () => ({ checkAddress: jest.fn() }));
jest.mock('./bitcoin', () => ({ bitcoinStrategy: jest.fn() }));
jest.mock('./bitcoin/config', () => ({ hydrateApiBase: jest.fn() }));
jest.mock('./solana', () => ({ solanaStrategy: {} }));
jest.mock('./chains/watcher', () => ({ checkBalances: jest.fn() }));
jest.mock('@/lib/lifi', () => ({
  ...jest.requireActual('@/lib/lifi'),
  lifiToken: jest.fn(),
  lifiQuote: jest.fn(),
  lifiStatus: jest.fn(),
}));
jest.mock('@/lib/evm/wallet', () => ({ walletClientFor: jest.fn() }));
jest.mock('@/lib/evm/chains', () => ({
  ...jest.requireActual('@/lib/evm/chains'),
  publicClientFor: jest.fn(),
}));

const me = '0x0000000000000000000000000000000000000002' as const;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
const ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE' as const;
const HASH = `0x${'ab'.repeat(32)}` as const;
const APPROVAL = `0x${'cd'.repeat(32)}` as const;

const eth = (chainId: number): LifiToken => ({ address: LIFI_NATIVE, chainId, symbol: 'ETH', decimals: 18 });
const usdc = (chainId: number, address: `0x${string}`): LifiToken => ({ address, chainId, symbol: 'USDC', decimals: 6 });

function quoteFor(from: LifiToken, fromAmount: string): LifiQuote {
  return {
    toolDetails: { name: 'Layerswap' },
    action: { fromAmount },
    estimate: {
      approvalAddress: ROUTER,
      toAmount: '2716948',
      toAmountMin: '2703363',
      executionDuration: 10,
      fromAmountUSD: '2.7280',
      toAmountUSD: '2.7141',
      feeCosts: [{ amount: '2500000000000', amountUSD: '0.0068', token: eth(from.chainId) }],
      gasCosts: [{ amount: '2834750000000', amountUSD: '0.0077', token: eth(from.chainId) }],
    },
    transactionRequest: { to: ROUTER, data: '0x4c279d6b', value: '0x38d7ea4c68000', gasLimit: '0xfe204' },
  };
}

const token = jest.mocked(lifiToken);
const quote = jest.mocked(lifiQuote);
const status = jest.mocked(lifiStatus);
const reads = { getBalance: jest.fn(), readContract: jest.fn(), waitForTransactionReceipt: jest.fn() };
const sendTransaction = jest.fn();

const context = {
  identity: { address: me, account: () => ({ address: me }) },
  storage: { get: async () => null },
} as unknown as PluginContext;

async function run(args: string[]) {
  const widgets: Widget[] = [];
  const result = await tradeCommand.run({
    args,
    rest: args.join(' '),
    conversationId: 'local-status',
    context,
    respond: async (content) => {
      if (typeof content !== 'string' && content.kind === 'widget') widgets.push(content.widget);
    },
  });
  const card = widgets.at(-1);
  const children = card?.kind === 'card' ? card.children : [];
  const find = <K extends Widget['kind']>(kind: K) =>
    children.find((c): c is Extract<Widget, { kind: K }> => c.kind === kind);
  return {
    result,
    title: card?.kind === 'card' ? card.title : undefined,
    message: result.type === 'error' ? result.message : '',
    form: find('form'),
    stat: find('stat'),
    rows: find('rows')?.rows,
    actions: find('actions')?.actions,
    codes: children.flatMap((c) => (c.kind === 'code' ? [c.value] : [])),
    links: children.flatMap((c) => (c.kind === 'link' ? [c] : [])),
  };
}

const field = (form: Extract<Widget, { kind: 'form' }> | undefined, id: string) =>
  form?.fields.find((f) => f.id === id);

const usdcToEth = async (params: { fromChain: number; fromAmount: bigint }) =>
  quoteFor(usdc(params.fromChain, USDC_BASE), params.fromAmount.toString());

const disposers: (() => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  for (const id of ['base', 'arbitrum']) {
    const chain = evmStrategy(EVM_CHAINS.find((spec) => spec.id === id)!);
    chain.transfer!.assets = async () => [{ symbol: 'USDC', id: USDC_BASE, held: '12' }];
    disposers.push(registerChainStrategy(chain));
  }
  jest.mocked(publicClientFor).mockReturnValue(reads as never);
  jest.mocked(walletClientFor).mockReturnValue({ sendTransaction } as never);
  reads.getBalance.mockResolvedValue(10n ** 18n);
  reads.readContract.mockResolvedValue(0n);
  reads.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
  sendTransaction.mockReset().mockResolvedValueOnce(APPROVAL).mockResolvedValueOnce(HASH);
  token.mockImplementation(async (chainId) => usdc(chainId, chainId === 8453 ? USDC_BASE : USDC_ARB));
  quote.mockImplementation(async (params) => quoteFor(eth(params.fromChain), params.fromAmount.toString()));
});

afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

describe('/trade', () => {
  it('opens a from/to form on the default network, with LI.FI credited', async () => {
    const { result, form, links } = await run([]);

    expect(result).toEqual({ type: 'handled' });
    expect(field(form, 'from')?.value).toBe('base');
    expect(field(form, 'to')?.value).toBe('base');
    expect(field(form, 'from')?.options?.map((o) => o.value)).toEqual(['base', 'arbitrum']);
    expect(field(form, 'token')?.options).toEqual(
      expect.arrayContaining([
        { label: 'ETH', value: 'native', when: { from: 'base' } },
        { label: 'USDC', value: USDC_BASE, when: { from: 'base' } },
      ])
    );
    expect(form?.submit.command).toBe('/trade {amount} {token} {receive} --from {from} --to {to}');
    expect(links).toContainEqual(expect.objectContaining({ label: 'Powered by LI.FI', url: 'https://li.fi' }));
    expect(quote).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the form has to ask for the rest', async () => {
    const { form } = await run(['0.5', 'usdc', '--to', 'arbitrum']);

    expect(field(form, 'amount')?.value).toBe('0.5');
    expect(field(form, 'token')?.value).toBe(USDC_BASE);
    expect(field(form, 'to')?.value).toBe('arbitrum');
  });

  it('refuses a network that is not EVM, and one that is off', async () => {
    expect((await run(['--from', 'bitcoin'])).message).toMatch(/EVM networks, and Bitcoin is not one/);
    expect((await run(['--to', 'polygon'])).message).toMatch(/not switched on/);
  });

  it('quotes a bridge and offers confirmation without signing anything', async () => {
    const { result, title, stat, rows, actions, links } = await run(['0.001', 'native', 'USDC', '--from', 'base', '--to', 'arbitrum']);

    expect(result).toEqual({ type: 'handled' });
    expect(token).toHaveBeenCalledTimes(1);
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ fromChain: 8453, toChain: 42161, fromToken: LIFI_NATIVE, toToken: USDC_ARB, fromAmount: 10n ** 15n, fromAddress: me }),
      null
    );
    expect(title).toBe('Bridge Base → Arbitrum One');
    expect(stat).toEqual(expect.objectContaining({ value: '≈ 2.716948 USDC', label: 'You receive on Arbitrum One' }));
    expect(rows).toEqual([
      { label: 'You send', value: '0.001 ETH on Base' },
      { label: 'Route', value: 'Layerswap' },
      { label: 'Takes about', value: '10 s' },
      { label: 'Network fee', value: '0.000003 ETH (≈ $0.01)' },
      { label: 'Route fees', value: '0.000003 ETH (≈ $0.01)' },
      { label: 'Value', value: '$2.73 → $2.71' },
    ]);
    expect(actions).toEqual([
      { label: 'Confirm and bridge', command: '/trade 0.001 native USDC --from base --to arbitrum --confirm' },
    ]);
    expect(links.map((l) => l.label)).toContain('Powered by LI.FI');
    expect(walletClientFor).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('stops before asking LI.FI when the balance does not cover the amount', async () => {
    reads.getBalance.mockResolvedValue(10n ** 14n);

    const { message } = await run(['0.001', 'native', 'USDC', '--from', 'base', '--to', 'base']);

    expect(message).toMatch(/Not enough ETH on Base/);
    expect(message).toMatch(/Nothing was sent/);
    expect(quote).not.toHaveBeenCalled();
  });

  it('stops before the quote is signed when the balance does not also cover gas', async () => {
    reads.getBalance.mockResolvedValue(10n ** 15n);

    const { message } = await run(['0.001', 'native', 'USDC', '--from', 'base', '--to', 'base', '--confirm']);

    expect(message).toMatch(/Not enough ETH on Base/);
    expect(message).toMatch(/in fees/);
    expect(message).toMatch(/Nothing was sent/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('surfaces LI.FI’s own explanation when there is no route', async () => {
    quote.mockRejectedValue(new LifiError(404, 'LI.FI found no route for this trade. A larger amount or a different pair may have one.'));

    const { message } = await run(['0.001', 'native', 'USDC', '--from', 'base', '--to', 'arbitrum']);

    expect(message).toMatch(/no route for this trade/);
    expect(message).toMatch(/Nothing was sent/);
  });

  it('names a token LI.FI does not know', async () => {
    token.mockResolvedValue(null);

    const { message } = await run(['0.001', 'native', 'NOPE', '--from', 'base', '--to', 'arbitrum']);

    expect(message).toMatch(/"NOPE" is not a token LI.FI knows on Arbitrum One/);
    expect(quote).not.toHaveBeenCalled();
  });

  it('sends the quoted transaction on confirm, with no approval for the native coin', async () => {
    sendTransaction.mockReset().mockResolvedValueOnce(HASH);

    const { result, title, actions } = await run(['0.001', 'native', 'USDC', '--from', 'base', '--to', 'arbitrum', '--confirm']);

    expect(result).toEqual({ type: 'handled' });
    expect(walletClientFor).toHaveBeenCalledWith(expect.objectContaining({ address: me }), 8453);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: ROUTER, data: '0x4c279d6b', value: 0x38d7ea4c68000n, gas: 0xfe204n, chain: null })
    );
    expect(title).toBe('Bridge started');
    expect(actions).toEqual([{ label: 'Check status', command: `/trade --status ${HASH} --from base --to arbitrum` }]);
  });

  it('approves the route contract first when a token allowance is short', async () => {
    quote.mockImplementation(usdcToEth);
    reads.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'balanceOf' ? 12_000_000n : 0n
    );

    const { result, codes } = await run(['5', USDC_BASE, 'native', '--from', 'base', '--to', 'base', '--confirm']);

    expect(result).toEqual({ type: 'handled' });
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(sendTransaction.mock.calls[0][0]).toEqual(expect.objectContaining({ to: USDC_BASE, chain: null }));
    expect(sendTransaction.mock.calls[0][0].data).toMatch(/^0x095ea7b3/);
    expect(reads.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: APPROVAL }));
    expect(sendTransaction.mock.calls[1][0]).toEqual(expect.objectContaining({ to: ROUTER }));
    expect(codes).toEqual([APPROVAL, HASH]);
  });

  it('skips the approval when the allowance already covers the amount', async () => {
    quote.mockImplementation(usdcToEth);
    reads.readContract.mockResolvedValue(12_000_000n);
    sendTransaction.mockReset().mockResolvedValueOnce(HASH);

    await run(['5', USDC_BASE, 'native', '--from', 'base', '--to', 'base', '--confirm']);

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction.mock.calls[0][0]).toEqual(expect.objectContaining({ to: ROUTER }));
  });

  it('warns against repeating a trade whose card could not be posted', async () => {
    sendTransaction.mockReset().mockResolvedValueOnce(HASH);
    const args = ['0.001', 'native', 'USDC', '--from', 'base', '--to', 'base', '--confirm'];
    const result = await tradeCommand.run({
      args,
      rest: args.join(' '),
      conversationId: 'local-status',
      context,
      respond: async () => {
        throw new Error('Network request failed');
      },
    });

    const message = result.type === 'error' ? result.message : '';
    expect(message).toMatch(/Your trade was sent on Base/);
    expect(message).toMatch(/Do not send it again/);
    expect(message).toContain(HASH);
  });

  it('asks LI.FI how a bridge is doing', async () => {
    status.mockResolvedValue({
      status: 'DONE',
      substatusMessage: 'The transfer is complete.',
      sending: { txHash: HASH, chainId: 8453, amount: '1000000000000000', token: eth(8453) },
      receiving: { txHash: HASH, txLink: `https://arbiscan.io/tx/${HASH}`, chainId: 42161, amount: '2716948', token: usdc(42161, USDC_ARB) },
      lifiExplorerLink: `https://scan.li.fi/tx/${HASH}`,
    });

    const { result, stat, rows, actions } = await run(['--status', HASH, '--from', 'base', '--to', 'arbitrum']);

    expect(result).toEqual({ type: 'handled' });
    expect(status).toHaveBeenCalledWith({ txHash: HASH, fromChain: 8453, toChain: 42161 }, null);
    expect(stat).toEqual(expect.objectContaining({ value: 'Done', caption: 'The transfer is complete.' }));
    expect(rows).toEqual([
      { label: 'Sent', value: '0.001 ETH on Base' },
      { label: 'Received', value: '2.716948 USDC on Arbitrum One' },
    ]);
    expect(actions).toBeUndefined();
  });
});
