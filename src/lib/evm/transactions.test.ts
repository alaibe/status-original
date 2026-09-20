import { findTransactionHash } from './transactions';

const HASH = '0x' + 'a1b2c3d4'.repeat(8);

describe('findTransactionHash', () => {
  it('finds a hash on its own', () => {
    expect(findTransactionHash(HASH)).toBe(HASH);
  });

  it('finds one inside a sentence', () => {
    expect(findTransactionHash(`sent it — ${HASH} — should be quick`)).toBe(HASH);
  });

  it('ignores an address, which is half the length', () => {
    // 40 hex characters is an address; treating one as a transaction would
    // show a card that never resolves.
    expect(findTransactionHash('0x1234567890123456789012345678901234567890')).toBeNull();
  });

  it('ignores a longer hex run', () => {
    expect(findTransactionHash('0x' + 'a'.repeat(70))).toBeNull();
  });

  it('ignores ordinary text', () => {
    expect(findTransactionHash('paid you back, check your wallet')).toBeNull();
  });

  it('accepts either case', () => {
    const upper = '0x' + 'AB'.repeat(32);
    expect(findTransactionHash(upper)).toBe(upper);
  });
});
