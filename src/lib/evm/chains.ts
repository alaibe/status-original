import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  type Chain,
} from 'viem/chains';
import { createPublicClient, http, type PublicClient } from 'viem';

import { flagValue, withoutFlag } from '@/core/commands/flags';

export const KNOWN_CHAINS: readonly Chain[] = [
  mainnet,
  base,
  optimism,
  arbitrum,
  polygon,
  sepolia,
  optimismSepolia,
  baseSepolia,
  arbitrumSepolia,
];

export const SUPPORTED_CHAINS = KNOWN_CHAINS.filter((c) => !c.testnet);

export const DEFAULT_CHAIN = base;

const clients = new Map<number, PublicClient>();

const rpcOverrides = new Map<number, string>();

export function rpcOverrideFor(chainId: number): string | undefined {
  return rpcOverrides.get(chainId);
}

export function setRpcOverride(chainId: number, url: string | null): void {
  if (url) rpcOverrides.set(chainId, url);
  else rpcOverrides.delete(chainId);
  clients.delete(chainId);
}

export function chainById(id: number): Chain | undefined {
  return KNOWN_CHAINS.find((c) => c.id === id);
}

export function chainSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

export function chainByName(name: string | undefined): Chain | undefined {
  if (!name) return undefined;
  return SUPPORTED_CHAINS.find((c) => chainSlug(c.name) === chainSlug(name));
}

export function chainFromArgs(args: string[]): {
  chain: Chain;
  rest: string[];
  explicit: boolean;
} {
  const chain = chainByName(flagValue(args, '--chain', ['-c']));
  return {
    chain: chain ?? DEFAULT_CHAIN,
    rest: withoutFlag(args, '--chain', ['-c']),
    explicit: Boolean(chain),
  };
}

export function trimDecimals(value: string, places = 6): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(places).replace(/\.?0+$/, '') : value;
}

export function publicClientFor(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;

  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);

  const client = createPublicClient({
    chain,
    transport: http(rpcOverrides.get(chainId), {
      batch: true,
      timeout: 8_000,
      retryCount: 1,
    }),
  }) as PublicClient;
  clients.set(chainId, client);
  return client;
}

export function toCaip2(chainId: number): string {
  return `eip155:${chainId}`;
}

export function fromCaip2(caip2: string): number | null {
  const match = /^eip155:(\d+)$/.exec(caip2);
  return match ? Number(match[1]) : null;
}
