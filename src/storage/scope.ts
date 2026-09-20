import AsyncStorage from '@react-native-async-storage/async-storage';

export function scopePrefix(accountId: string): string {
  return `a.${accountId}.`;
}

export async function scopedKeysFor(accountId: string): Promise<string[]> {
  const prefix = scopePrefix(accountId);
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((key) => key.startsWith(prefix));
}

export async function clearScope(accountId: string): Promise<void> {
  const keys = await scopedKeysFor(accountId);
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}
