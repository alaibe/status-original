import { isAddress } from 'viem';

import { looksLikeEnsName, resolveName } from '@/lib/evm/ens';

export interface ResolvedBot {
  address: string;
  name?: string;
  description?: string;
}

/**
 * `weather@bots.example.org` is read from
 * `https://bots.example.org/.well-known/status-bot/weather.json`.
 */
export async function resolveBot(input: string): Promise<ResolvedBot | null> {
  const value = input.trim();

  const handle = /^([a-z0-9_-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(value);
  if (handle) {
    const [, id, domain] = handle;
    try {
      const response = await fetch(
        `https://${domain}/.well-known/status-bot/${id.toLowerCase()}.json`
      );
      if (!response.ok) return null;
      const card = (await response.json()) as Partial<ResolvedBot>;
      if (typeof card.address !== 'string' || !isAddress(card.address)) return null;
      return {
        address: card.address,
        name: typeof card.name === 'string' ? card.name : undefined,
        description: typeof card.description === 'string' ? card.description : undefined,
      };
    } catch {
      return null;
    }
  }

  if (!isAddress(value) && looksLikeEnsName(value)) {
    try {
      const address = await resolveName(value);
      return address ? { address } : null;
    } catch {
      return null;
    }
  }

  return { address: value };
}
