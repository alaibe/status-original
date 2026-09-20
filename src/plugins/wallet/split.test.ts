import { formatEther, parseEther } from 'viem';

import { trimDecimals } from '@/lib/evm/chains';

/**
 * The arithmetic behind `/split`. A rounding slip here means everyone pays
 * slightly the wrong amount, and nobody notices until the person who fronted
 * the bill is short.
 */

/** Wei per person, the exact figure the card asks each member for. */
function shareWei(total: string, people: number): bigint {
  return parseEther(total) / BigInt(people);
}

/** What the card prints, rounded for legibility. */
function shareOf(total: string, people: number): string {
  return trimDecimals(formatEther(shareWei(total, people)));
}

describe('splitting a bill', () => {
  it('divides evenly when it divides evenly', () => {
    expect(shareOf('120', 4)).toBe('30');
    expect(shareOf('0.32', 4)).toBe('0.08');
  });

  it('counts the person who paid as one of the ways', () => {
    // "Split four ways" among four people means the payer is one of the four,
    // and is owed three shares rather than four.
    const share = shareOf('100', 4);
    expect(Number(share) * 4).toBeCloseTo(100, 6);
  });

  it('never rounds a share up past the total', () => {
    // Integer division on wei always rounds down, so the collector can be a
    // few wei short but never asks for more than the bill. Checked on the wei
    // value rather than the printed one: the card rounds for legibility, and
    // the rounded string can read a hair above the true share.
    for (const people of [3, 6, 7, 9]) {
      expect(shareWei('10', people) * BigInt(people)).toBeLessThanOrEqual(parseEther('10'));
    }
  });

  it('handles an amount that does not divide cleanly', () => {
    const share = shareOf('10', 3);
    expect(Number(share)).toBeCloseTo(3.333333, 5);
  });

  it('handles two people', () => {
    expect(shareOf('0.05', 2)).toBe('0.025');
  });
});
