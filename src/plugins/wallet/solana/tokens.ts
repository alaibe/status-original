import { formatUnits } from 'viem';

import { shortAddress } from '@/core/identity/keyring';
import { jsonRpc } from '@/lib/json-rpc';

/** The original token program, and the 2022 one that newer mints use. */
const PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

type Entry = [mint: string, symbol: string, name: string];

/** 109KB and a 1500-entry map, built on the first balance rather than at startup. */
let names: Map<string, Entry> | null = null;

function named(): Map<string, Entry> {
  names ??= new Map(
    (require('./token-list.json') as { tokens: Entry[] }).tokens.map((entry) => [entry[0], entry])
  );
  return names;
}

/** A balance card is a list, not an inventory. */
const MOST = 25;

export interface SplBalance {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: string;
  raw: bigint;
  listed: boolean;
}

interface ParsedAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: { amount: string; decimals: number };
        };
      };
    };
  };
}

/**
 * Solana keeps an account per mint, so the chain reports everything held and
 * the bundled list only puts a name to it.
 */
export async function fetchSplTokens(url: string, owner: string): Promise<SplBalance[]> {
  const answers = await Promise.all(
    PROGRAMS.map((programId) =>
      jsonRpc<{ value: ParsedAccount[] }>(url, 'getTokenAccountsByOwner', [
        owner,
        { programId },
        { encoding: 'jsonParsed' },
      ]).catch(() => ({ value: [] as ParsedAccount[] }))
    )
  );

  // One mint can sit in several accounts; what is held is their sum, so the
  // raw amounts are added up before any of them is formatted.
  const held = new Map<string, { raw: bigint; decimals: number }>();

  for (const { value } of answers) {
    for (const { account } of value) {
      const { mint, tokenAmount } = account.data.parsed.info;
      const raw = BigInt(tokenAmount.amount);
      if (raw === 0n) continue;

      const running = (held.get(mint)?.raw ?? 0n) + raw;
      held.set(mint, { raw: running, decimals: tokenAmount.decimals });
    }
  }

  const byMint = named();

  return [...held.entries()]
    .map(([mint, { raw, decimals }]) => {
      const entry = byMint.get(mint);
      return {
        mint,
        symbol: entry?.[1] ?? shortAddress(mint, 4, 4),
        name: entry?.[2] ?? 'Unknown token',
        decimals,
        amount: formatUnits(raw, decimals),
        raw,
        listed: entry !== undefined,
      };
    })
    .sort((a, b) => Number(b.listed) - Number(a.listed) || a.symbol.localeCompare(b.symbol))
    .slice(0, MOST);
}
