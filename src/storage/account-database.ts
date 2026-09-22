/**
 * The slice of a SQLite connection the app relies on. `expo-sqlite` satisfies
 * it on iOS and Android; the desktop app satisfies it over Tauri commands.
 */
export type BindValue = string | number | boolean | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface AccountDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: BindValue[]): Promise<RunResult>;
  getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
  withExclusiveTransactionAsync(
    work: (transaction: AccountDatabase) => Promise<void>
  ): Promise<void>;
  closeAsync(): Promise<void>;
}
