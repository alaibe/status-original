import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';

import { publicClientFor } from './chains';
import { listedToken, listedTokens, type ListedToken } from './token-list';

export function supportsTokens(chainId: number): boolean {
  return listedTokens(chainId).length > 0;
}

export interface TokenBalance {
  contract: Address;
  symbol: string;
  name: string;
  decimals: number;
  raw: bigint;
  amount: string;
}

/**
 * viem splits the calls by this and runs the parts together. Its default of
 * 1024 bytes would make dozens of requests per chain; this is about a hundred
 * calls apiece.
 */
const BATCH_BYTES = 24_000;

async function balancesOf(
  chainId: number,
  address: Address,
  tokens: ListedToken[]
): Promise<{ token: ListedToken; raw: bigint }[]> {
  const results = await publicClientFor(chainId).multicall({
    allowFailure: true,
    batchSize: BATCH_BYTES,
    contracts: tokens.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address] as const,
    })),
  });

  return results.flatMap((result, i) =>
    result.status === 'success' && result.result > 0n
      ? [{ token: tokens[i], raw: result.result }]
      : []
  );
}

export async function describeToken(
  chainId: number,
  contract: Address
): Promise<ListedToken | null> {
  const listed = listedToken(chainId, contract);
  if (listed) return listed;

  const client = publicClientFor(chainId);
  const token = { address: contract, abi: erc20Abi } as const;

  const [symbol, name, decimals] = await client.multicall({
    allowFailure: true,
    contracts: [
      { ...token, functionName: 'symbol' },
      { ...token, functionName: 'name' },
      { ...token, functionName: 'decimals' },
    ],
  });

  if (decimals.status !== 'success') return null;
  return {
    address: contract,
    symbol: symbol.status === 'success' ? symbol.result : '???',
    name: name.status === 'success' ? name.result : 'Unknown token',
    decimals: decimals.result,
  };
}

/** Long enough that a card and the form opened from it cost one scan. */
const FRESH_MS = 30_000;

/** A balance card is a list, not an inventory. */
const MOST = 25;

function withoutAny(listed: ListedToken[], extra: ListedToken[]): ListedToken[] {
  const added = new Set(extra.map((token) => token.address.toLowerCase()));
  return listed.filter((token) => !added.has(token.address.toLowerCase()));
}

const recent = new Map<string, { at: number; tokens: TokenBalance[] }>();

export function clearTokenCache(): void {
  recent.clear();
}

/** `extra` is what the account added by hand, on top of the bundled list. */
export async function fetchTokens(
  chainId: number,
  address: Address,
  { extra = [] }: { extra?: ListedToken[] } = {}
): Promise<TokenBalance[]> {
  const cacheKey = `${chainId}:${address.toLowerCase()}:${extra.map((t) => t.address).join(',')}`;
  const cached = recent.get(cacheKey);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.tokens;

  const listed = listedTokens(chainId);
  const candidates = extra.length ? [...extra, ...withoutAny(listed, extra)] : listed;
  if (candidates.length === 0) return [];

  const held = await balancesOf(chainId, address, candidates);

  const tokens = held.slice(0, MOST).map(({ token, raw }) => ({
    contract: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    raw,
    amount: formatUnits(raw, token.decimals),
  }));

  recent.set(cacheKey, { at: Date.now(), tokens });
  return tokens;
}

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: [
      {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ],
    functionName: 'transfer',
    args: [to, amount],
  });
}

export function toTokenUnits(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}
