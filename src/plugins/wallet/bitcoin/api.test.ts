import { formatBtc } from './api';

describe('formatBtc', () => {
  it('formats whole and fractional amounts without float error', () => {
    expect(formatBtc(100_000_000n)).toBe('1');
    expect(formatBtc(150_000_000n)).toBe('1.5');
    expect(formatBtc(1n)).toBe('0.00000001');
    expect(formatBtc(0n)).toBe('0');
  });

  it('keeps precision that a JS number would lose', () => {
    // 21M BTC in sats exceeds Number.MAX_SAFE_INTEGER, which is exactly why
    // this works in bigint throughout.
    expect(formatBtc(2_100_000_000_000_000n)).toBe('21000000');
  });

  it('handles a negative pending delta', () => {
    expect(formatBtc(-50_000_000n)).toBe('-0.5');
  });
});
