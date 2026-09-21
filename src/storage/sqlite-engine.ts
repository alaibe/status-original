import * as SQLite from 'expo-sqlite';

import type { AccountDatabase } from './account-database';

export function openDatabase(name: string): Promise<AccountDatabase> {
  return SQLite.openDatabaseAsync(name);
}

export function deleteDatabase(name: string): Promise<void> {
  return SQLite.deleteDatabaseAsync(name);
}
