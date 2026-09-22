import { zeroAddress, type Address, type Hex } from 'viem';

import { HttpError } from '@/core/errors';

const BASE = 'https://li.quest/v1';

/** Names this app in LI.FI's routing stats; it is not a credential. */
const INTEGRATOR = 'status-original';

export const LIFI_NATIVE: Address = zeroAddress;

export const lifiExplorerUrl = (hash: string) => `https://scan.li.fi/tx/${hash}`;

export interface LifiToken {
  address: Address;
  chainId: number;
  symbol: string;
  decimals: number;
}

interface LifiCost {
  amount: string;
  amountUSD?: string;
  token: LifiToken;
}

export interface LifiQuote {
  toolDetails: { name: string };
  action: { fromAmount: string };
  estimate: {
    approvalAddress: Address;
    toAmount: string;
    toAmountMin: string;
    executionDuration: number;
    fromAmountUSD?: string;
    toAmountUSD?: string;
    feeCosts?: LifiCost[];
    gasCosts?: LifiCost[];
    skipApproval?: boolean;
  };
  transactionRequest: { to: Address; data: Hex; value?: Hex; gasLimit?: Hex };
}

export type LifiStatusValue = 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED';

interface LifiLeg {
  txHash: string;
  txLink?: string;
  chainId: number;
  amount?: string;
  token?: LifiToken;
}

export interface LifiStatus {
  status: LifiStatusValue;
  substatusMessage?: string;
  sending?: LifiLeg;
  receiving?: LifiLeg;
  lifiExplorerLink?: string;
}

export class LifiError extends HttpError {
  constructor(
    status: number,
    message: string,
    readonly code?: number
  ) {
    super(status, message);
    this.name = 'LifiError';
  }
}

const NO_ROUTE = 1002;
const BAD_REQUEST = 1011;

async function get<T>(path: string, params: Record<string, string | number>, key: string | null): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([name, value]) => [name, String(value)]));
  const response = await fetch(`${BASE}${path}?${query}`, {
    headers: key ? { 'x-lifi-api-key': key } : undefined,
  });

  if (response.ok) return (await response.json()) as T;

  if (response.status === 429) {
    throw new LifiError(
      429,
      'LI.FI is limiting quotes from this device. Wait a while, or add your own LI.FI key under Settings → Trades.'
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new LifiError(response.status, 'That LI.FI key was rejected. Check it under Settings → Trades.');
  }

  const body = (await response.json().catch(() => null)) as { message?: string; code?: number } | null;
  if (body?.code === NO_ROUTE) {
    throw new LifiError(
      response.status,
      'LI.FI found no route for this trade. A larger amount or a different pair may have one.',
      NO_ROUTE
    );
  }
  throw new LifiError(
    response.status,
    body?.message ?? `LI.FI could not be reached (HTTP ${response.status}).`,
    body?.code
  );
}

const tokens = new Map<string, LifiToken>();

/** `token` is a symbol or contract address; null when LI.FI does not know it on that chain. */
export async function lifiToken(
  chainId: number,
  token: string,
  key: string | null
): Promise<LifiToken | null> {
  const cacheKey = `${chainId}:${token.toLowerCase()}`;
  const cached = tokens.get(cacheKey);
  if (cached) return cached;
  try {
    const found = await get<LifiToken>('/token', { chain: chainId, token }, key);
    tokens.set(cacheKey, found);
    return found;
  } catch (error) {
    if (error instanceof LifiError && error.code === BAD_REQUEST) return null;
    throw error;
  }
}

export interface LifiQuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: Address;
  toToken: Address;
  fromAddress: Address;
  /** In the token's base units. */
  fromAmount: bigint;
  slippage: number;
}

export function lifiQuote(params: LifiQuoteParams, key: string | null): Promise<LifiQuote> {
  return get<LifiQuote>(
    '/quote',
    { ...params, fromAmount: params.fromAmount.toString(), integrator: INTEGRATOR },
    key
  );
}

export function lifiStatus(
  params: { txHash: string; fromChain: number; toChain: number },
  key: string | null
): Promise<LifiStatus> {
  return get<LifiStatus>('/status', params, key);
}
