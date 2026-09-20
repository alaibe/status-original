import { loadGifKey, saveGifKey } from '@/features/chat/attachments/gifs';

describe('gif key storage', () => {
  it('round-trips a key per account', async () => {
    await saveGifKey('acct-1', '  AIzaTestKey123  ');
    expect(await loadGifKey('acct-1')).toBe('AIzaTestKey123');
    expect(await loadGifKey('acct-2')).toBeNull();
  });

  it('clears the key when given an empty string', async () => {
    await saveGifKey('acct-1', 'AIzaTestKey123');
    await saveGifKey('acct-1', '');
    expect(await loadGifKey('acct-1')).toBeNull();
  });
});
