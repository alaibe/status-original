import AsyncStorage from '@react-native-async-storage/async-storage';

import { eraseAccountStorage } from './erase';
import { scopePrefix } from './scope';
import { accountMnemonicKey, vaultGet, vaultSet } from './vault';

describe('the erase path', () => {
  it('keeps identity keys when another medium fails and succeeds on retry', async () => {
    const accountId = 'retry-account';
    const key = scopePrefix(accountId) + 'chat.readAt';
    await AsyncStorage.setItem(key, '{}');
    await vaultSet(accountMnemonicKey(accountId), 'secret');
    jest.spyOn(AsyncStorage, 'multiRemove').mockRejectedValueOnce(new Error('storage busy'));

    await expect(eraseAccountStorage(accountId)).rejects.toThrow('async-storage');
    expect(await vaultGet(accountMnemonicKey(accountId))).toBe('secret');

    await expect(eraseAccountStorage(accountId)).resolves.toBeDefined();
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(await vaultGet(accountMnemonicKey(accountId))).toBeNull();
  });
});
