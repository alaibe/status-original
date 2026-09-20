import { createAccountStorage } from '@/storage/account';
import { loadPluginPrefs, resolveEnabledIds, savePluginPrefs } from './storage';

const ALL = ['assistant', 'ethereum', 'browser', 'uniswap'];
const DEFAULTS = ['assistant', 'ethereum', 'browser', 'uniswap'];

describe('resolveEnabledIds', () => {
  it('uses the defaults on a fresh install', () => {
    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs: null })).toEqual(DEFAULTS);
  });

  it('introduces plugins the user has never been offered', () => {
    // The exact bug this guards: an install that predates `assistant` and
    // `uniswap` would otherwise never see them, no matter how many updates.
    const prefs = {
      enabled: ['ethereum', 'browser'],
      known: ['ethereum', 'browser'],
    };

    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs }).sort()).toEqual(
      ['assistant', 'browser', 'ethereum', 'uniswap'].sort()
    );
  });

  it('respects a plugin the user turned off', () => {
    const prefs = {
      enabled: ['assistant'],
      known: ALL,
    };
    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs })).toEqual(['assistant']);
  });

  it('does not re-enable a new plugin that is off by default', () => {
    const prefs = { enabled: ['assistant'], known: ['assistant'] };
    expect(
      resolveEnabledIds({ all: ALL, defaults: ['assistant', 'ethereum'], prefs }).sort()
    ).toEqual(['assistant', 'ethereum']);
  });

  it('drops ids for plugins that no longer exist', () => {
    const prefs = {
      enabled: ['ethereum', 'removed-plugin'],
      known: [...ALL, 'removed-plugin'],
    };
    expect(resolveEnabledIds({ all: ALL, defaults: DEFAULTS, prefs })).toEqual(['ethereum']);
  });
});

describe('plugin preferences are per account', () => {
  /**
   * Without bound storage a freshly created account inherits the previous
   * account's choices wholesale: twelve plugins already enabled and a `known`
   * list claiming it had been offered all fifteen. Passing bound storage to
   * both calls makes that impossible. What one account stores is invisible to
   * another, whatever the ambient scope happens to say.
   */
  it('does not let one account read or overwrite another', async () => {
    const accountA = createAccountStorage('account-a');
    const accountB = createAccountStorage('account-b');
    await savePluginPrefs(accountA, {
      enabled: ['assistant', 'bitcoin'],
      known: ['assistant', 'bitcoin', 'markets'],
    });

    expect(await loadPluginPrefs(accountB)).toBeNull();

    await savePluginPrefs(accountB, { enabled: [], known: ['assistant'] });

    expect(await loadPluginPrefs(accountA)).toEqual({
      enabled: ['assistant', 'bitcoin'],
      known: ['assistant', 'bitcoin', 'markets'],
    });
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
