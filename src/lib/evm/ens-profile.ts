import type { Address } from 'viem';
import { mainnet } from 'viem/chains';

import { publicClientFor } from './chains';
import { lookupName } from './ens';
import { viemEns } from './viem-ens';

const BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as const;

const NAME_EXPIRES_ABI = [
  {
    name: 'nameExpires',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export async function ensPaidUntil(name: string): Promise<Date | null> {
  const parts = name.toLowerCase().split('.');
  if (parts.length !== 2 || parts[1] !== 'eth') return null;

  try {
    const { labelhash } = viemEns();
    const expiry = await ensClient().readContract({
      address: BASE_REGISTRAR,
      abi: NAME_EXPIRES_ABI,
      functionName: 'nameExpires',
      args: [BigInt(labelhash(parts[0]))],
    });
    return expiry > 0n ? new Date(Number(expiry) * 1000) : null;
  } catch {
    return null;
  }
}

export interface EnsProfile {
  name: string;
  avatar: string | null;
  description: string | null;
  url: string | null;
  paidUntil: Date | null;
}

function ensClient() {
  return publicClientFor(mainnet.id);
}

const profileCache = new Map<string, EnsProfile | null>();

const TEXT_KEYS = ['description', 'url'] as const;

export async function resolveEnsProfile(address: Address): Promise<EnsProfile | null> {
  const key = address.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key) ?? null;

  try {
    const name = await lookupName(address);
    if (!name) {
      profileCache.set(key, null);
      return null;
    }

    const normalized = viemEns().normalize(name);
    const client = ensClient();

    const [avatar, description, url, paidUntil] = await Promise.all([
      client.getEnsAvatar({ name: normalized }).catch(() => null),
      client.getEnsText({ name: normalized, key: TEXT_KEYS[0] }).catch(() => null),
      client.getEnsText({ name: normalized, key: TEXT_KEYS[1] }).catch(() => null),
      ensPaidUntil(name).catch(() => null),
    ]);

    const profile: EnsProfile = {
      name,
      avatar: avatar ?? null,
      description,
      url,
      paidUntil,
    };
    profileCache.set(key, profile);
    return profile;
  } catch {
    return null;
  }
}

export async function resolveEnsProfiles(
  addresses: Address[],
  batchSize = 5
): Promise<Record<string, EnsProfile>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
  const out: Record<string, EnsProfile> = {};

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((a) => resolveEnsProfile(a)));
    batch.forEach((address, index) => {
      const profile = results[index];
      if (profile) out[address] = profile;
    });
  }

  return out;
}

export function clearEnsProfileCache(): void {
  profileCache.clear();
}
