import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearScope, scopePrefix } from './scope';
import { createAccountStorage } from './account';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('account storage', () => {
  it('gives two accounts different keys for the same logical value', () => {
    expect(createAccountStorage('one').key('chat.prefs')).not.toBe(
      createAccountStorage('two').key('chat.prefs')
    );
  });

  it('binds plugin reads and writes to their owning account', async () => {
    const a = createAccountStorage('one').plugin('wallet');
    const b = createAccountStorage('two').plugin('wallet');
    await a.set('network', 'mainnet');

    expect(await a.get('network')).toBe('mainnet');
    expect(await b.get('network')).toBeNull();
  });
});

describe('clearScope', () => {
  it('removes one account without touching another', async () => {
    await AsyncStorage.multiSet([
      [scopePrefix('a') + 'chat.readAt', '{"a":1}'],
      [scopePrefix('b') + 'chat.readAt', '{"b":1}'],
    ]);

    await clearScope('a');

    expect(await AsyncStorage.getItem(scopePrefix('a') + 'chat.readAt')).toBeNull();
    expect(await AsyncStorage.getItem(scopePrefix('b') + 'chat.readAt')).toBe('{"b":1}');
  });
});
