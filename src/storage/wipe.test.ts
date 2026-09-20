import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearScope } from './scope';
import { createAccountStorage } from './account';

/** AsyncStorage keys owned by an account. */
const ACCOUNT_DATA = [
  'chat.readAt',
  'chat.prefs',
  'chat.mediaIndex',
  'plugins.prefs',
  'plugin:wallet:networks',
];

const DEVICE_SETTINGS: string[] = [];

const ACCOUNT_SETTINGS = ['appearance'];

/** Not ours. Wiping another library's keys would be a bug with no upside. */
const FOREIGN = ['expo.something', 'RCTAsyncLocalStorage_key'];

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function seedFor(accountId: string) {
  const storage = createAccountStorage(accountId);
  for (const key of [...ACCOUNT_DATA, ...ACCOUNT_SETTINGS]) {
    await AsyncStorage.setItem(storage.key(key), 'x');
  }
  for (const key of [...DEVICE_SETTINGS, ...FOREIGN]) await AsyncStorage.setItem(key, 'x');
}

describe('erasing one account', () => {
  it('removes every scoped key it wrote', async () => {
    await seedFor('acct-a');

    await clearScope('acct-a');

    const left = await AsyncStorage.getAllKeys();
    expect(left.filter((k) => k.startsWith('a.acct-a.'))).toEqual([]);
  });

  it('leaves another account untouched', async () => {
    await seedFor('acct-a');
    await seedFor('acct-b');

    await clearScope('acct-a');

    const left = await AsyncStorage.getAllKeys();
    expect(left.filter((k) => k.startsWith('a.acct-b.'))).toHaveLength(
      ACCOUNT_DATA.length + ACCOUNT_SETTINGS.length
    );
  });

  it('leaves device settings and other libraries alone', async () => {
    await seedFor('acct-a');

    await clearScope('acct-a');

    const left = await AsyncStorage.getAllKeys();
    for (const key of [...DEVICE_SETTINGS, ...FOREIGN]) expect(left).toContain(key);
  });
});
