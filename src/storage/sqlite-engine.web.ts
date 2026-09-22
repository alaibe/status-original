import { invoke } from '@tauri-apps/api/core';

import type { AccountDatabase, BindValue, RunResult } from './account-database';

/**
 * One SQLCipher connection per database, owned by the Rust side and addressed
 * by name. Callers serialise their own work per account, so `BEGIN EXCLUSIVE`
 * followed by `COMMIT` on that one connection is a real transaction.
 */
class DesktopDatabase implements AccountDatabase {
  constructor(private readonly name: string) {}

  async execAsync(sql: string): Promise<void> {
    await invoke('db_exec', { name: this.name, sql });
  }

  runAsync(sql: string, ...params: BindValue[]): Promise<RunResult> {
    return invoke<RunResult>('db_run', { name: this.name, sql, params });
  }

  async getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, ...params);
    return rows[0] ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]> {
    const { columns, rows } = await invoke<{ columns: string[]; rows: unknown[][] }>('db_all', {
      name: this.name,
      sql,
      params,
    });
    return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])) as T);
  }

  async withExclusiveTransactionAsync(
    work: (transaction: AccountDatabase) => Promise<void>
  ): Promise<void> {
    await this.execAsync('BEGIN EXCLUSIVE');
    try {
      await work(this);
      await this.execAsync('COMMIT');
    } catch (error) {
      await this.execAsync('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    await invoke('db_close', { name: this.name });
  }
}

export async function openDatabase(name: string): Promise<AccountDatabase> {
  await invoke('db_open', { name });
  return new DesktopDatabase(name);
}

export async function deleteDatabase(name: string): Promise<void> {
  await invoke('db_delete', { name });
}
