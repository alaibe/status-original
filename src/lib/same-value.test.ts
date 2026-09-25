import { sameValue } from './same-value';

describe('sameValue', () => {
  it('compares nested objects and arrays by content', () => {
    expect(
      sameValue(
        { id: 'a', memberIds: ['x', 'y'], lastMessage: { content: { kind: 'text', text: 'hi' } } },
        { id: 'a', memberIds: ['x', 'y'], lastMessage: { content: { kind: 'text', text: 'hi' } } }
      )
    ).toBe(true);
  });

  it('notices a changed, missing or extra field', () => {
    expect(sameValue({ typing: true }, { typing: false })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('tells arrays from objects and order from content', () => {
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
  });
});
