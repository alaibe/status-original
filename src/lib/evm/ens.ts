import { isAddress, type Address } from 'viem';
import { mainnet } from 'viem/chains';

import { publicClientFor } from './chains';
import { viemEns } from './viem-ens';

function ensClient() {
  return publicClientFor(mainnet.id);
}

export const CoinType = {
  bitcoin: 0n,
  ethereum: 60n,
} as const;

const forwardCache = new Map<string, Address | null>();
const reverseCache = new Map<string, string | null>();
const coinCache = new Map<string, string | null>();

function normalizedName(value: string): string | null {
  try {
    return viemEns().normalize(value);
  } catch {
    return null;
  }
}

export function looksLikeEnsName(value: string): boolean {
  return /\.[a-z]{2,}$/i.test(value.trim());
}

export async function resolveName(input: string): Promise<Address | null> {
  const value = input.trim();
  if (isAddress(value)) return value as Address;
  if (!looksLikeEnsName(value)) return null;

  const name = normalizedName(value);
  if (!name) return null;

  const key = value.toLowerCase();
  if (forwardCache.has(key)) return forwardCache.get(key) ?? null;

  const address = await ensClient().getEnsAddress({ name });
  forwardCache.set(key, address);
  return address;
}

export async function resolveNameForCoin(input: string, coinType: bigint): Promise<string | null> {
  const value = input.trim();
  if (!looksLikeEnsName(value)) return null;

  const name = normalizedName(value);
  if (!name) return null;

  const key = `${value.toLowerCase()}:${coinType}`;
  if (coinCache.has(key)) return coinCache.get(key) ?? null;

  const address = await ensClient().getEnsAddress({ name, coinType });
  coinCache.set(key, address ?? null);
  return address ?? null;
}

export async function lookupName(address: Address): Promise<string | null> {
  const key = address.toLowerCase();
  if (reverseCache.has(key)) return reverseCache.get(key) ?? null;

  try {
    const name = await ensClient().getEnsName({ address });
    reverseCache.set(key, name);
    return name;
  } catch {
    return null;
  }
}
