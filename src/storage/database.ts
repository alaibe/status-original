import * as SQLite from 'expo-sqlite';

import { accountDatabaseKey } from './vault';

const SCHEMA_VERSION = 2;

const databases = new Map<string, Promise<SQLite.SQLiteDatabase>>();
const operations = new Map<string, { tail: Promise<void>; deleting: boolean; generation: number }>();

function operationState(accountId: string) {
  let state = operations.get(accountId);
  if (!state) {
    state = { tail: Promise.resolve(), deleting: false, generation: 0 };
    operations.set(accountId, state);
  }
  return state;
}

export function accountDatabaseGeneration(accountId: string): number {
  return operationState(accountId).generation;
}

export function runAccountDatabaseOperation<T>(
  accountId: string,
  generation: number,
  work: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const state = operationState(accountId);
  if (state.deleting || state.generation !== generation) {
    return Promise.reject(new Error('Account database is being deleted or has been deleted.'));
  }

  const result = state.tail.then(() => openAccountDatabase(accountId).then(work));
  state.tail = result.then(() => {}, () => {});
  return result;
}

export function databaseNameFor(accountId: string): string {
  return `account-${accountId}.db`;
}

export function openAccountDatabase(accountId: string): Promise<SQLite.SQLiteDatabase> {
  const existing = databases.get(accountId);
  if (existing) return existing;

  const opening = (async () => {
    const db = await SQLite.openDatabaseAsync(databaseNameFor(accountId));
    try {
      const key = await accountDatabaseKey(accountId);
      await db.execAsync(`PRAGMA key = '${key.replace(/'/g, "''")}'`);
      const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      if (!cipher?.cipher_version) throw new Error('SQLCipher is unavailable in this app build.');

      await migrate(db);
      return db;
    } catch (error) {
      await db.closeAsync().catch(() => {});
      throw error;
    }
  })();

  databases.set(accountId, opening);
  void opening.catch(() => {
    if (databases.get(accountId) === opening) databases.delete(accountId);
  });
  return opening;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS conversations (
        id           TEXT PRIMARY KEY NOT NULL,
        protocol_id  TEXT NOT NULL,
        participants TEXT NOT NULL,
        title        TEXT,
        created_at   INTEGER NOT NULL,
        hidden       INTEGER NOT NULL DEFAULT 0,
        routing_key  TEXT
      );

      CREATE INDEX IF NOT EXISTS conversations_by_protocol
        ON conversations (protocol_id);

      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        sender_id       TEXT NOT NULL,
        sent_at         INTEGER NOT NULL,
        from_me         INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'sent',
        content         TEXT NOT NULL,
        reply_to        TEXT,
        PRIMARY KEY (conversation_id, id)
      );

      -- Every read is "the newest N in this conversation, oldest first".
      CREATE INDEX IF NOT EXISTS messages_by_conversation
        ON messages (conversation_id, sent_at);
    `);
  }

  if (current < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS transport_cursors (
        protocol_id    TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        timestamp      INTEGER NOT NULL,
        PRIMARY KEY (protocol_id, conversation_id)
      );
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export async function deleteAccountDatabase(accountId: string): Promise<void> {
  const state = operationState(accountId);
  state.deleting = true;
  state.generation += 1;
  await state.tail;

  const opening = databases.get(accountId);
  databases.delete(accountId);

  const failures: unknown[] = [];
  if (opening) {
    let db: SQLite.SQLiteDatabase | undefined;
    try {
      db = await opening;
    } catch {}
    if (db) {
      try {
        await db.closeAsync();
      } catch (error) {
        failures.push(error);
      }
    }
  }

  try {
    await SQLite.deleteDatabaseAsync(databaseNameFor(accountId));
  } catch (error) {
    failures.push(error);
  }
  state.deleting = false;
  if (failures.length > 0) throw new AggregateError(failures, 'Could not delete account database.');
}
