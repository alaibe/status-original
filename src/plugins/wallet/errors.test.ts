import {
  BaseError,
  EstimateGasExecutionError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  TimeoutError,
  TransactionRejectedRpcError,
  UserRejectedRequestError,
} from 'viem';

import type { ChainStrategy } from './chains/strategy';
import { walletErrorMessage } from './errors';

const polygon = { name: 'Polygon', transfer: { symbol: 'POL' } } as ChainStrategy;
const endpoint = 'https://user:private-password@rpc.example.invalid/private-api-key';
const body = { method: 'eth_estimateGas', params: ['private-request-body'] };

const rejectedEstimate = new EstimateGasExecutionError(
  new TransactionRejectedRpcError(
    new RpcRequestError({
      body,
      error: { code: -32003, message: 'EVM error: OutOfFunds' },
      url: endpoint,
    })
  ),
  { to: '0x0000000000000000000000000000000000000001', value: 1n }
);

describe('walletErrorMessage', () => {
  it('uses the nested OutOfFunds cause rather than mistaking an RPC rejection for a cancellation', () => {
    const message = walletErrorMessage(rejectedEstimate, polygon, 'review');

    expect(message).toMatch(/not enough|insufficient/i);
    expect(message).toContain('Polygon');
    expect(message).toMatch(/POL.*fees|fees.*POL/i);
    expect(message).toMatch(/add POL on Polygon/i);
    expect(message).toMatch(/other networks cannot pay/i);
    expect(message).toMatch(/nothing was sent/i);
    expect(message).not.toMatch(/cancel|approve|ETH|Transaction creation failed/i);
  });

  it('recognizes a typed insufficient-balance error even without provider wording', () => {
    const message = walletErrorMessage(new InsufficientFundsError(), polygon, 'review');

    expect(message).toMatch(/not enough|insufficient/i);
    expect(message).toMatch(/add POL/i);
    expect(message).toMatch(/POL.*fees/i);
  });

  it('prioritizes nested HTTP 429 over the enclosing request failure and strips its diagnostics', () => {
    const error = new BaseError('HTTP request failed.', {
      cause: new HttpRequestError({ status: 429, body, url: endpoint }),
    });
    const message = walletErrorMessage(error, polygon, 'balance');

    expect(message).toMatch(/limit/i);
    expect(message).toMatch(/wait/i);
    expect(message).toMatch(/balance/i);
    expect(message).not.toMatch(
      /internet connection|private-|rpc\.example|https:|request body|viem@|transaction/i
    );
  });

  it('keeps unsupported-chain recovery separate from endpoint configuration', () => {
    const error = new BaseError('Could not estimate gas.', {
      cause: new Error('Unsupported chain 11155111'),
    });
    const message = walletErrorMessage(error, { ...polygon, name: 'Sepolia' }, 'review');

    expect(message).toMatch(/Sepolia.*not available/i);
    expect(message).toContain('/networks');
    expect(message).not.toContain('/rpc');
  });

  it('distinguishes user cancellation from a transfer that would revert during review', () => {
    const cancelled = walletErrorMessage(
      new UserRejectedRequestError(new Error('Rejected')),
      polygon,
      'review'
    );
    const reverted = walletErrorMessage(
      new ExecutionRevertedError({ message: 'execution reverted' }),
      polygon,
      'review'
    );

    expect(cancelled).toMatch(/cancelled/i);
    expect(cancelled).toMatch(/approve only if/i);
    expect(reverted).toMatch(/would be rejected/i);
    expect(reverted).toMatch(/check the recipient/i);
    expect(reverted).toMatch(/nothing was sent/i);
    expect(reverted).not.toMatch(/was rejected|was reverted/i);
  });

  it('distinguishes safe review failure from an uncertain send outcome after the same timeout', () => {
    const error = new TimeoutError({ body, url: endpoint });
    const review = walletErrorMessage(error, polygon, 'review');
    const send = walletErrorMessage(error, polygon, 'send');

    expect(review).toMatch(/did not respond in time/i);
    expect(review).toMatch(/nothing was sent/i);
    expect(send).toMatch(/may have been submitted/i);
    expect(send).toMatch(/history or .*explorer before trying again/i);
    expect(send).not.toMatch(
      /nothing was sent|no funds|private-|rpc\.example|https:|request body|viem@/i
    );
  });

  it('does not treat a cancelled HTTP request as a user cancelling the payment', () => {
    const error = Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
    const message = walletErrorMessage(error, polygon, 'send');

    expect(message).toMatch(/network service.*could not be reached/i);
    expect(message).toMatch(/history or .*explorer before trying again/i);
    expect(message).not.toMatch(/approve|nothing was sent/i);
  });

  it('does not diagnose a reverted token balance as a shortage of the native gas currency', () => {
    const error = new ExecutionRevertedError({ message: 'ERC20: transfer amount exceeds balance' });
    const message = walletErrorMessage(error, polygon, 'review');

    expect(message).toMatch(/would be rejected/i);
    expect(message).toMatch(/token/i);
    expect(message).not.toMatch(/add POL|not enough POL/i);
  });

  it('keeps an unclassified send outcome uncertain instead of treating it as safe to repeat', () => {
    const message = walletErrorMessage(
      new Error('The remote service stopped responding.'),
      polygon,
      'send'
    );

    expect(message).toMatch(/may have been submitted/i);
    expect(message).toMatch(/before trying again/i);
    expect(message).not.toMatch(/nothing was sent/i);
  });

  it('makes unknown RPC errors operation-aware without exposing provider diagnostics or promising send failure', () => {
    const error = new RpcRequestError({
      body,
      error: {
        code: -32603,
        message: 'Internal failure: Authorization: Bearer private-token\nstack: private-stack',
      },
      url: endpoint,
    });
    const send = walletErrorMessage(error, polygon, 'send');
    const fees = walletErrorMessage(error, polygon, 'fees');

    expect(send).toContain('Polygon');
    expect(send).toMatch(/may have been submitted/i);
    expect(send).toMatch(/before trying again/i);
    expect(send).not.toMatch(
      /private-|Authorization|rpc\.example|https:|viem@|nothing was sent|Transaction creation failed/i
    );
    expect(fees).toMatch(/load network fees/i);
    expect(fees).not.toMatch(/transaction creation|may have been submitted|nothing was sent/i);
  });

  it('retains ordinary domain guidance without using unrelated diagnostic details', () => {
    const error = Object.assign(new Error('Recipient is not supported.\nInternal diagnostic'), {
      details: 'private-provider-diagnostic',
    });
    const message = walletErrorMessage(error, polygon, 'review');

    expect(message).toMatch(/recipient is not supported/i);
    expect(message).not.toMatch(/internal diagnostic|private-provider/i);
  });
});
