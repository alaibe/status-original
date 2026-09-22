import { EstimateGasExecutionError, RpcRequestError, TransactionRejectedRpcError } from 'viem';

import type { PluginContext } from '@/core/plugins/types';
import type { Widget } from '@/design/widgets';
import { stubMulticall } from '@/lib/evm/testing/multicall';
import { clearTokenCache } from '@/lib/evm/tokens';
import { estimateTransfer } from '@/lib/evm/wallet';

import { EVM_CHAINS, evmStrategy } from './chains/evm';
import { registerChainStrategy, type ChainStrategy } from './chains/strategy';
import { walletCommands } from './commands';

jest.mock('./bitcoin/bot', () => ({ checkAddress: jest.fn() }));
jest.mock('./bitcoin', () => ({ bitcoinStrategy: jest.fn() }));
jest.mock('./bitcoin/config', () => ({ hydrateApiBase: jest.fn() }));
jest.mock('./solana', () => ({ solanaStrategy: {} }));
jest.mock('./chains/watcher', () => ({ checkBalances: jest.fn() }));

jest.mock('@/lib/evm/wallet', () => ({
  estimateTransfer: jest.fn(),
  sendNative: jest.fn(() => { throw new Error('Broadcast forbidden in review'); }),
  walletClientFor: jest.fn(() => { throw new Error('Signing forbidden in review'); }),
}));

// Balances are read from the chain now, so a form listing assets needs one.
beforeEach(() => {
  clearTokenCache();
  stubMulticall();
});

const recipient = '0x0000000000000000000000000000000000000001';
const sender = '0x0000000000000000000000000000000000000002';
const estimate = jest.mocked(estimateTransfer);

const rejection = new EstimateGasExecutionError(
  new TransactionRejectedRpcError(new RpcRequestError({
    body: { method: 'eth_estimateGas', params: [{ from: sender, to: recipient, value: '0x1' }] },
    error: { code: -32003, message: 'EVM error: OutOfFunds' },
    url: 'https://rpc.example.invalid/private-endpoint',
  })),
  { to: recipient, value: 1n }
);

async function runSend(
  chainId = 'ethereum',
  options: { to?: string; confirmed?: boolean; responseError?: Error } = {}
) {
  let widget: Widget | undefined;
  const args = ['0.00000001', options.to ?? recipient, '--chain', chainId];
  if (options.confirmed) args.push('--confirm');
  const result = await walletCommands.find((command) => command.name === 'send')!.run({
    args,
    rest: args.join(' '),
    conversationId: 'local-status',
    context: {
      identity: { address: sender, account: () => ({ address: sender }) },
    } as unknown as PluginContext,
    respond: async (content) => {
      if (options.responseError) throw options.responseError;
      if (typeof content !== 'string' && content.kind === 'widget') widget = content.widget;
    },
  });
  return { result, widget };
}

describe('/send errors and confirmation', () => {
  let chain: ChainStrategy;
  let dispose: () => void;
  let commit: jest.Mock;

  beforeEach(() => {
    estimate.mockReset();
    estimate.mockResolvedValue({
      value: 10_000_000_000n,
      balance: 1_000_000_000_000_000_000n,
      feeEstimate: 21_000n,
      sufficient: true,
      formatted: { value: '0.00000001', balance: '1', fee: '0.000000000000021' },
    });
    chain = evmStrategy(EVM_CHAINS.find((spec) => spec.id === 'ethereum')!);
    commit = jest.fn(() => { throw new Error('Commit forbidden in review'); });
    chain.transfer!.commit = commit;
    dispose = registerChainStrategy(chain);
  });

  afterEach(() => {
    dispose();
  });

  it('starts the recipient on your own address, which is the one it knows', async () => {
    let widget: Widget | undefined;
    const args = ['--chain', 'ethereum'];
    await walletCommands.find((command) => command.name === 'send')!.run({
      args,
      rest: args.join(' '),
      conversationId: 'local-status',
      context: {
        identity: { address: sender, account: () => ({ address: sender }) },
      } as unknown as PluginContext,
      respond: async (content) => {
        if (typeof content !== 'string' && content.kind === 'widget') widget = content.widget;
      },
    });

    const form = widget?.kind === 'card' ? widget.children.find((c) => c.kind === 'form') : undefined;
    const to = form?.kind === 'form' ? form.fields.find((f) => f.id === 'to') : undefined;

    expect(to?.value).toBe(sender);
  });


  it('explains the observed OutOfFunds rejection in the selected native currency', async () => {
    estimate.mockRejectedValue(rejection);

    const { result, widget } = await runSend();

    expect(result.type).toBe('error');
    const message = result.type === 'error' ? result.message : '';
    expect(message).toContain('ETH');
    expect(message).toContain('Ethereum');
    expect(message).toMatch(/gas|fees/i);
    expect(message).toMatch(/nothing was sent/i);
    expect(widget).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });


  it('explains malformed recipients before estimation or signing', async () => {
    const { result, widget } = await runSend('ethereum', { to: '0x00' });

    expect(result.type).toBe('error');
    const message = result.type === 'error' ? result.message : '';
    expect(message).toContain('Ethereum');
    expect(message).toMatch(/full 0x address/i);
    expect(message).toContain('ENS');
    expect(widget).toBeUndefined();
    expect(estimate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('opens the form with the recipient filled in when only an address is given', async () => {
    let widget: Widget | undefined;
    const context = {
      identity: { address: sender, account: () => ({ address: sender }) },
      storage: { get: async () => null },
    } as unknown as PluginContext;
    const result = await walletCommands.find((command) => command.name === 'send')!.run({
      args: [recipient],
      rest: recipient,
      conversationId: 'local-status',
      context,
      respond: async (content) => {
        if (typeof content !== 'string' && content.kind === 'widget') widget = content.widget;
      },
    });

    expect(result.type).toBe('handled');
    const form = widget?.kind === 'card' ? widget.children.find((c) => c.kind === 'form') : undefined;
    expect(form?.kind === 'form' ? form.fields.find((f) => f.id === 'to')?.value : undefined).toBe(recipient);
    expect(form?.kind === 'form' ? form.fields.find((f) => f.id === 'amount')?.value : undefined).toBe('');
    expect(estimate).not.toHaveBeenCalled();
  });

  it('does not imply submission when confirmation fails during its fresh review', async () => {
    estimate.mockRejectedValue(rejection);

    const { result } = await runSend('ethereum', { confirmed: true });
    const message = result.type === 'error' ? result.message : '';
    expect(message).toMatch(/nothing was sent/i);
    expect(message).not.toMatch(/may have been submitted/i);
    expect(commit).not.toHaveBeenCalled();
  });

  it('warns against repeating a payment when its submission response is lost', async () => {
    commit.mockRejectedValue(new Error('Network request failed'));

    const { result, widget } = await runSend('ethereum', { confirmed: true });
    const message = result.type === 'error' ? result.message : '';
    expect(message).toMatch(/may have been submitted/i);
    expect(message).toMatch(/before trying again/i);
    expect(message).not.toMatch(/nothing was sent/i);
    expect(widget).toBeUndefined();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('reports a sent payment, not a failed transfer, when posting its receipt fails', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    commit.mockResolvedValue(hash);

    const { result } = await runSend('ethereum', {
      confirmed: true,
      responseError: new Error('Network request failed'),
    });
    const message = result.type === 'error' ? result.message : '';
    expect(message).toMatch(/payment was sent on Ethereum/i);
    expect(message).toContain(hash);
    expect(message).toMatch(/do not send it again/i);
    expect(message).not.toMatch(/nothing was sent|may have been submitted/i);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('shows a confirmation action after a successful quote without committing', async () => {

    const { result, widget } = await runSend();
    const actions = widget?.kind === 'card'
      ? widget.children.find((child) => child.kind === 'actions')
      : undefined;

    expect(result).toEqual({ type: 'handled' });
    expect(actions?.kind === 'actions' ? actions.actions : undefined).toEqual([
      expect.objectContaining({
        command: `/send 0.00000001 ${recipient} --chain ethereum --confirm`,
      }),
    ]);
    expect(commit).not.toHaveBeenCalled();
  });
});

it('rejects a missing selected token instead of sending native currency', async () => {
  const { sendNative, walletClientFor } = jest.requireMock('@/lib/evm/wallet');
  sendNative.mockClear();
  walletClientFor.mockClear();
  const transfer = evmStrategy(EVM_CHAINS.find((spec) => spec.id === 'ethereum')!).transfer!;
  const context = {
    identity: { address: sender, account: () => ({ address: sender }) },
  } as unknown as PluginContext;

  await expect(transfer.commit(context, {
    amount: '1',
    to: recipient,
    asset: `0x${'cd'.repeat(20)}`,
  })).rejects.toThrow(/selected token.*Ethereum/i);
  expect(sendNative).not.toHaveBeenCalled();
  expect(walletClientFor).not.toHaveBeenCalled();
});
