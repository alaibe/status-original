import { formatUnits } from 'viem';

import { HttpError } from '@/core/errors';

export const DEFAULT_API_BASE = 'https://mempool.space/api';

export interface AddressStats {
  confirmed: bigint;
  pending: bigint;
  txCount: number;
}

interface ChainStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

export async function fetchAddressStats(
  address: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<AddressStats> {
  const response = await fetch(`${apiBase}/address/${encodeURIComponent(address)}`);

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.status === 400
        ? 'That does not look like a valid Bitcoin address.'
        : `Explorer returned ${response.status}.`
    );
  }

  const body = (await response.json()) as {
    chain_stats: ChainStats;
    mempool_stats: ChainStats;
  };

  const confirmed =
    BigInt(body.chain_stats.funded_txo_sum) - BigInt(body.chain_stats.spent_txo_sum);
  const pending =
    BigInt(body.mempool_stats.funded_txo_sum) - BigInt(body.mempool_stats.spent_txo_sum);

  return { confirmed, pending, txCount: body.chain_stats.tx_count };
}

export function formatBtc(sats: bigint): string {
  return formatUnits(sats, 8);
}

interface RawUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

export async function fetchUtxos(
  address: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<{ txid: string; vout: number; value: bigint }[]> {
  const response = await fetch(`${apiBase}/address/${encodeURIComponent(address)}/utxo`);
  if (!response.ok) {
    throw new HttpError(response.status, `Could not read unspent outputs (${response.status})`);
  }

  const raw = (await response.json()) as RawUtxo[];
  return raw
    .filter((u) => u.status.confirmed)
    .map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value) }));
}

export interface FeeRates {
  fast: number;
  medium: number;
  slow: number;
}

export async function fetchFeeRates(apiBase: string = DEFAULT_API_BASE): Promise<FeeRates> {
  const response = await fetch(`${apiBase}/v1/fees/recommended`);
  if (!response.ok) {
    throw new HttpError(response.status, `Could not read fee rates (${response.status})`);
  }

  const raw = (await response.json()) as {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
  };
  return {
    fast: Math.max(1, raw.fastestFee),
    medium: Math.max(1, raw.halfHourFee),
    slow: Math.max(1, raw.hourFee),
  };
}

export async function broadcast(
  hex: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<string> {
  const response = await fetch(`${apiBase}/tx`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: hex,
  });
  const body = (await response.text()).trim();
  if (!response.ok) {
    throw new HttpError(response.status, body || `Broadcast failed (${response.status})`);
  }
  return body;
}
