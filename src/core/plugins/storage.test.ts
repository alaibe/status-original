import { createAccountStorage } from '@/storage/account';
import { loadPluginPrefs, resolveEnabledIds, savePluginPrefs } from './storage';

const ALL = ['assistant', 'ethereum', 'browser', 'uniswap'];
const DEFAULTS = ['assistant', 'ethereum', 'browser', 'uniswap'];

describe('resolveEnabledIds', () => {
  it('uses the defaults on a fresh install', () => {
    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs: null })).toEqual(DEFAULTS);
  });

  it('respects a plugin the user turned off', () => {
    const prefs = { enabled: ['assistant'] };
    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs })).toEqual(['assistant']);
  });
});

describe('plugin preferences are per account', () => {
  /**
   * Without bound storage a freshly created account inherits the previous
   * account's choices wholesale. Passing bound storage to both calls makes that
   * impossible: what one account stores is invisible to another, whatever the
   * ambient scope happens to say.
   */
  it('does not let one account read or overwrite another', async () => {
    const accountA = createAccountStorage('account-a');
    const accountB = createAccountStorage('account-b');
    await savePluginPrefs(accountA, { enabled: ['assistant', 'bitcoin'] });

    expect(await loadPluginPrefs(accountB)).toBeNull();

    await savePluginPrefs(accountB, { enabled: [] });

    expect(await loadPluginPrefs(accountA)).toEqual({ enabled: ['assistant', 'bitcoin'] });
  });

  it('gives a brand-new account the defaults, not whatever was on before', () => {
    // No prefs is the whole signal: it means nobody has chosen yet here.
    expect(
      resolveEnabledIds({
        all: ['assistant', 'profile', 'bitcoin', 'markets'],
        defaults: ['assistant', 'profile'],
        prefs: null,
      })
    ).toEqual(['assistant', 'profile']);
  });
});
