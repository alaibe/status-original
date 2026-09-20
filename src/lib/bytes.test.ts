import { concat, fromHex, stripHex, toHex, u32le, u64le } from './bytes';

describe('concat', () => {
  it('joins in order and handles empty parts', () => {
    expect([...concat([Uint8Array.from([1, 2]), new Uint8Array(), Uint8Array.from([3])])]).toEqual([
      1, 2, 3,
    ]);
    expect(concat([])).toHaveLength(0);
  });
});

describe('hex', () => {
  it('round-trips, with or without the prefix', () => {
    expect(toHex(fromHex('00ff1a'))).toBe('00ff1a');
    expect(toHex(fromHex('0x00ff1a'))).toBe('00ff1a');
  });

  it('pads single digits, so byte boundaries survive', () => {
    // Dropping the pad would turn 0x0a into "a" and shift every byte after it.
    expect(toHex(Uint8Array.from([0, 10, 255]))).toBe('000aff');
  });

  it('strips only a leading prefix', () => {
    expect(stripHex('0xabc')).toBe('abc');
    expect(stripHex('abc')).toBe('abc');
    expect(stripHex('ab0xc')).toBe('ab0xc');
  });
});

describe('little-endian numbers', () => {
  it('writes low byte first', () => {
    // Both formats use little-endian; big-endian here would spend the wrong
    // amount and reference the wrong output.
    expect([...u32le(1)]).toEqual([1, 0, 0, 0]);
    expect([...u64le(1n)]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('carries a full range', () => {
    expect(new DataView(u64le(2n ** 63n).buffer).getBigUint64(0, true)).toBe(2n ** 63n);
  });
});
