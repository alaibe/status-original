import { encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';

import { jsonRpc } from '@/lib/json-rpc';

const NETWORK: Record<number, string> = {
  [mainnet.id]: 'eth-mainnet',
  [base.id]: 'base-mainnet',
  [optimism.id]: 'opt-mainnet',
  [arbitrum.id]: 'arb-mainnet',
  [polygon.id]: 'polygon-mainnet',
};

export function supportsTokens(chainId: number): boolean {
  return chainId in NETWORK;
}

export function alchemyUrl(chainId: number, key: string): string {
  const network = NETWORK[chainId];
  if (!network) throw new Error('That chain has no token index.');
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

export interface TokenBalance {
  contract: Address;
  symbol: string;
  name: string;
  decimals: number;
  raw: bigint;
  amount: string;
}

function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  return jsonRpc<T>(url, method, params, {
    onStatus: (status) =>
      status === 401 || status === 403
        ? 'That Alchemy key was rejected. Check it in Settings.'
        : undefined,
  });
}

interface RawBalances {
  tokenBalances: { contractAddress: Address; tokenBalance: Hex | null }[];
}

interface RawMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
}

const metaCache = new Map<string, TokenMeta>();

const metaKey = (chainId: number, contract: Address) =>
  `${chainId}:${contract.toLowerCase()}`;

export function primeTokenMeta(chainId: number, entries: Record<string, TokenMeta>): void {
  for (const [contract, meta] of Object.entries(entries)) {
    metaCache.set(metaKey(chainId, contract as Address), meta);
  }
}

export function tokenMetaFor(chainId: number): Record<string, TokenMeta> {
  const prefix = `${chainId}:`;
  return Object.fromEntries(
    [...metaCache.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, meta]) => [key.slice(prefix.length), meta])
  );
}

export function clearTokenMeta(): void {
  metaCache.clear();
}

export async function fetchTokens(
  chainId: number,
  address: Address,
  key: string,
  { limit = 25 }: { limit?: number } = {}
): Promise<TokenBalance[]> {
  const url = alchemyUrl(chainId, key);
  const balances = await rpc<RawBalances>(url, 'alchemy_getTokenBalances', [address]);

  const held = balances.tokenBalances
    .map((entry) => ({ contract: entry.contractAddress, raw: BigInt(entry.tokenBalance ?? '0x0') }))
    .filter((entry) => entry.raw > 0n)
    .slice(0, limit);

  const unknown = held.filter((entry) => !metaCache.has(metaKey(chainId, entry.contract)));
  const fetched = await Promise.all(
    unknown.map((entry) =>
      rpc<RawMetadata>(url, 'alchemy_getTokenMetadata', [entry.contract]).catch(() => null)
    )
  );

  unknown.forEach((entry, i) => {
    const raw = fetched[i];
    if (!raw || raw.decimals === null) return;
    metaCache.set(metaKey(chainId, entry.contract), {
      name: raw.name ?? 'Unknown token',
      symbol: raw.symbol ?? '???',
      decimals: raw.decimals,
    });
  });

  return held.flatMap((entry) => {
    const meta = metaCache.get(metaKey(chainId, entry.contract));
    if (!meta) return [];
    return [
      {
        contract: entry.contract,
        ...meta,
        raw: entry.raw,
        amount: formatUnits(entry.raw, meta.decimals),
      },
    ];
  });
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
