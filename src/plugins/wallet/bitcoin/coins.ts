import { virtualSize, type Utxo } from './transaction';

export const DUST_LIMIT = 294n;

export interface CoinPlan {
  inputs: Utxo[];
  send: bigint;
  change: bigint | null;
  fee: bigint;
  vsize: number;
}

export type CoinResult = { ok: true; plan: CoinPlan } | { ok: false; reason: string };

export function planSpend(
  utxos: Utxo[],
  target: bigint,
  feeRate: number,
  { sendMax = false }: { sendMax?: boolean } = {}
): CoinResult {
  if (feeRate <= 0) return { ok: false, reason: 'Fee rate must be positive.' };
  if (!sendMax && target <= 0n) return { ok: false, reason: 'That is nothing to send.' };
  if (utxos.length === 0) return { ok: false, reason: 'Nothing to spend.' };

  const sorted = [...utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const rate = BigInt(Math.ceil(feeRate));

  if (sendMax) {
    const total = sorted.reduce((sum, u) => sum + u.value, 0n);
    const vsize = virtualSize(sorted.length, 1);
    const fee = BigInt(vsize) * rate;
    const send = total - fee;
    if (send < DUST_LIMIT) {
      return { ok: false, reason: 'After the fee there would be nothing left to send.' };
    }
    return { ok: true, plan: { inputs: sorted, send, change: null, fee, vsize } };
  }

  const inputs: Utxo[] = [];
  let gathered = 0n;

  for (const utxo of sorted) {
    inputs.push(utxo);
    gathered += utxo.value;

    const withChange = virtualSize(inputs.length, 2);
    const feeWithChange = BigInt(withChange) * rate;
    const change = gathered - target - feeWithChange;

    if (change >= DUST_LIMIT) {
      return {
        ok: true,
        plan: { inputs: [...inputs], send: target, change, fee: feeWithChange, vsize: withChange },
      };
    }

    const withoutChange = virtualSize(inputs.length, 1);
    const feeWithoutChange = BigInt(withoutChange) * rate;
    if (gathered >= target + feeWithoutChange) {
      return {
        ok: true,
        plan: {
          inputs: [...inputs],
          send: target,
          change: null,
          fee: gathered - target,
          vsize: withoutChange,
        },
      };
    }
  }

  return { ok: false, reason: 'Not enough bitcoin, once the fee is counted.' };
}
