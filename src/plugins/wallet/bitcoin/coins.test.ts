import { planSpend, DUST_LIMIT } from './coins';
import { virtualSize, type Utxo } from './transaction';

const utxo = (value: bigint, i = 0): Utxo => ({ txid: 'ab'.repeat(32), vout: i, value });

/** What the plan pays out, which must never exceed what went in. */
const conserved = (inputs: Utxo[], send: bigint, change: bigint | null, fee: bigint) =>
  inputs.reduce((n, u) => n + u.value, 0n) === send + (change ?? 0n) + fee;

describe('planSpend', () => {
  it('conserves every satoshi', () => {
    // The invariant that matters most: inputs = sent + change + fee, exactly.
    // Any gap is money silently paid to a miner.
    for (const amount of [1_000n, 50_000n, 999_999n]) {
      const result = planSpend([utxo(2_000_000n)], amount, 10);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { inputs, send, change, fee } = result.plan;
      expect(conserved(inputs, send, change, fee)).toBe(true);
      expect(send).toBe(amount);
    }
  });

  it('prices the fee against virtual size, not byte length', () => {
    const result = planSpend([utxo(1_000_000n)], 100_000n, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Witness bytes are discounted fourfold; charging byte length would
    // overpay by roughly a third on every send.
    expect(result.plan.vsize).toBe(virtualSize(1, 2));
    expect(result.plan.fee).toBe(BigInt(result.plan.vsize) * 7n);
  });

  it('drops a dust change into the fee rather than creating an unspendable output', () => {
    // Chosen so the change lands just under the dust limit.
    const vsize = virtualSize(1, 2);
    const fee = BigInt(vsize) * 5n;
    const total = 100_000n + fee + (DUST_LIMIT - 1n);

    const result = planSpend([utxo(total)], 100_000n, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.change).toBeNull();
    expect(conserved(result.plan.inputs, result.plan.send, null, result.plan.fee)).toBe(true);
    // The recipient still gets exactly what was asked for.
    expect(result.plan.send).toBe(100_000n);
  });

  it('never returns change below the dust limit', () => {
    for (let extra = 0n; extra < 400n; extra += 37n) {
      const fee = BigInt(virtualSize(1, 2)) * 3n;
      const result = planSpend([utxo(10_000n + fee + extra)], 10_000n, 3);
      if (!result.ok) continue;
      if (result.plan.change !== null) expect(result.plan.change).toBeGreaterThanOrEqual(DUST_LIMIT);
    }
  });

  it('adds inputs until the fee is covered', () => {
    const result = planSpend([utxo(30_000n, 0), utxo(30_000n, 1), utxo(30_000n, 2)], 70_000n, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.inputs).toHaveLength(3);
    expect(conserved(result.plan.inputs, result.plan.send, result.plan.change, result.plan.fee)).toBe(true);
  });

  it('spends the biggest coins first, so the choice is explainable', () => {
    const result = planSpend([utxo(1_000n, 0), utxo(500_000n, 1), utxo(9_000n, 2)], 100_000n, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.inputs.map((u) => u.value)).toEqual([500_000n]);
  });

  it('refuses when the balance covers the amount but not the fee', () => {
    // The nastiest near-miss: it looks affordable until the fee is counted.
    const result = planSpend([utxo(100_010n)], 100_000n, 50);
    expect(result).toEqual({ ok: false, reason: 'Not enough bitcoin, once the fee is counted.' });
  });

  it('refuses an empty wallet, a zero amount and a zero fee rate', () => {
    expect(planSpend([], 1_000n, 5).ok).toBe(false);
    expect(planSpend([utxo(100_000n)], 0n, 5).ok).toBe(false);
    expect(planSpend([utxo(100_000n)], 1_000n, 0).ok).toBe(false);
  });

  describe('sweeping', () => {
    it('takes the fee out of the amount, with no change output', () => {
      const result = planSpend([utxo(80_000n, 0), utxo(20_000n, 1)], 0n, 6, { sendMax: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.plan.change).toBeNull();
      expect(result.plan.inputs).toHaveLength(2);
      expect(conserved(result.plan.inputs, result.plan.send, null, result.plan.fee)).toBe(true);
      expect(result.plan.send).toBe(100_000n - result.plan.fee);
    });

    it('refuses when the fee would eat everything', () => {
      const result = planSpend([utxo(500n)], 0n, 100, { sendMax: true });
      expect(result).toEqual({
        ok: false,
        reason: 'After the fee there would be nothing left to send.',
      });
    });
  });
});
