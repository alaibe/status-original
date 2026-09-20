import { loadTokenKey, saveTokenKey } from './token-key';

describe('the Alchemy key', () => {
  it('round-trips, trimmed, per account', async () => {
    await saveTokenKey('acct-1', '  alch_abc  ');

    expect(await loadTokenKey('acct-1')).toBe('alch_abc');
    // Two identities must not share a lookup history with an indexer.
    expect(await loadTokenKey('acct-2')).toBeNull();
  });

  it('deletes rather than storing an empty string', async () => {
    // Otherwise `loadTokenKey` hands back "" and the caller sends it upstream
    // as a key, which fails in a way that looks like the indexer is down.
    await saveTokenKey('acct-1', 'alch_abc');
    await saveTokenKey('acct-1', '   ');

    expect(await loadTokenKey('acct-1')).toBeNull();
  });
});
