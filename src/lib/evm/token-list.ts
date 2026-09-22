import type { Address } from 'viem';

export interface ListedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

type Entry = [address: string, symbol: string, name: string, decimals: number];

interface Bundled {
  source: string;
  name: string;
  version: string;
  tokens: Record<string, Entry[]>;
}

/** 58KB a messenger with the wallet switched off should never parse. */
let bundled: Bundled | null = null;

const list = (): Bundled => (bundled ??= require('./token-list.json') as Bundled);

const byChain = new Map<number, ListedToken[]>();

/** Alphabetical, and empty for a chain the list does not cover. */
export function listedTokens(chainId: number): ListedToken[] {
  const cached = byChain.get(chainId);
  if (cached) return cached;

  const entries = list().tokens[String(chainId)] ?? [];
  const tokens = entries.map(([address, symbol, name, decimals]) => ({
    address: address as Address,
    symbol,
    name,
    decimals,
  }));
  byChain.set(chainId, tokens);
  return tokens;
}

/**
 * An order, not a source: each symbol is looked up in the bundled list, and
 * one the list does not carry is not offered.
 */
const POPULAR: Record<number, string[]> = {
  1: ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC'],
  10: ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'OP'],
  137: ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC'],
  8453: ['USDC', 'DAI', 'WETH', 'cbBTC', 'AERO'],
  42161: ['USDC', 'DAI', 'WETH', 'WBTC', 'ARB'],
};

export function popularTokens(chainId: number): ListedToken[] {
  const listed = listedTokens(chainId);
  return (POPULAR[chainId] ?? []).flatMap((symbol) => {
    const found = listed.find((token) => token.symbol === symbol);
    return found ? [found] : [];
  });
}

export function listedToken(chainId: number, address: Address): ListedToken | undefined {
  const wanted = address.toLowerCase();
  return listedTokens(chainId).find((token) => token.address.toLowerCase() === wanted);
}

export function tokenList(): {
  name: string;
  version: string;
  source: string;
  count: number;
} {
  const { name, version, source, tokens } = list();
  return {
    name,
    version,
    source,
    count: Object.values(tokens).reduce((sum, entries) => sum + entries.length, 0),
  };
}
