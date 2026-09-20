import { conversationScope, inScope } from './conversation-scope';

describe('conversationScope', () => {
  it('recognizes a plugin channel', () => {
    expect(conversationScope('local-bitcoin')).toBe('channel');
  });

  it('reads a network conversation from its kind', () => {
    expect(conversationScope('xmtp-abc', 'dm')).toBe('dm');
    expect(conversationScope('xmtp-abc', 'group')).toBe('group');
    // No kind is the honest default: an id alone cannot tell them apart.
    expect(conversationScope('xmtp-abc')).toBe('dm');
  });
});

describe('inScope', () => {
  it('treats an undeclared scope as everywhere', () => {
    expect(inScope(undefined, 'dm')).toBe(true);
    expect(inScope(undefined, 'channel')).toBe(true);
  });

  it('honours a declaration', () => {
    expect(inScope(['group'], 'group')).toBe(true);
    expect(inScope(['group'], 'dm')).toBe(false);
  });
});
