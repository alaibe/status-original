import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PluginStorage } from '@/core/plugins/types';
import type { MessageStore } from '@/core/messaging/message-store';
import { SqliteMessageStore } from './sqlite-message-store';
import { scopePrefix } from './scope';

export interface AccountStorage {
  readonly accountId: string;
  key(name: string): string;
  get<T>(name: string): Promise<T | null>;
  set<T>(name: string, value: T): Promise<void>;
  remove(name: string): Promise<void>;
  plugin(pluginId: string): PluginStorage;
  readonly messages: MessageStore;
}

export function createAccountStorage(accountId: string): AccountStorage {
  const prefix = scopePrefix(accountId);
  const key = (name: string) => prefix + name;

  const storage: AccountStorage = {
    accountId,
    key,
    async get<T>(name: string) {
      const raw = await AsyncStorage.getItem(key(name));
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async set<T>(name: string, value: T) {
      await AsyncStorage.setItem(key(name), JSON.stringify(value));
    },
    async remove(name: string) {
      await AsyncStorage.removeItem(key(name));
    },
    plugin(pluginId: string) {
      const pluginKey = (name: string) => `plugin:${pluginId}:${name}`;
      return {
        get: <T>(name: string) => storage.get<T>(pluginKey(name)),
        set: <T>(name: string, value: T) => storage.set(pluginKey(name), value),
        remove: (name: string) => storage.remove(pluginKey(name)),
      };
    },
    messages: new SqliteMessageStore(accountId),
  };
  return storage;
}
