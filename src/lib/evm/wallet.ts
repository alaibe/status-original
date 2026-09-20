import {
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
  type WalletClient,
 LocalAccount } from 'viem';

import { chainById, publicClientFor, rpcOverrideFor } from './chains';

export function walletClientFor(account: LocalAccount, chainId: number): WalletClient {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);

  return createWalletClient({
    account,
    chain,
    transport: http(rpcOverrideFor(chainId), { timeout: 20_000, retryCount: 0 }),
  });
}

export interface SendNativeParams {
  account: LocalAccount;
  chainId: number;
  to: Address;
  amount: string;
}

export async function estimateTransfer({ account, chainId, to, amount }: SendNativeParams) {
  const publicClient = publicClientFor(chainId);
  const value = parseEther(amount);

  const [balance, gas, fees] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.estimateGas({ account: account.address, to, value }),
    publicClient.estimateFeesPerGas(),
  ]);

  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const feeEstimate = gas * maxFeePerGas;

  return {
    value,
    balance,
    feeEstimate,
    sufficient: balance >= value + feeEstimate,
    formatted: {
      value: formatEther(value),
      balance: formatEther(balance),
      fee: formatEther(feeEstimate),
    },
  };
}

export async function sendNative({ account, chainId, to, amount }: SendNativeParams): Promise<Hex> {
  const client = walletClientFor(account, chainId);

  return client.sendTransaction({
    account,
    chain: chainById(chainId),
    to,
    value: parseEther(amount),
  });
}
