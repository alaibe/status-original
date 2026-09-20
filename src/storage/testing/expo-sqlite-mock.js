/**
 * `expo-sqlite`, backed by Node's own SQLite.
 *
 * `SqliteMessageStore` needs a native module, so without this Jest cannot
 * reach it and the SQL is covered by nothing but the iOS build succeeding: a
 * schema typo, a wrong column order or a migration that never ran would not
 * fail a suite. Node 22+ ships `node:sqlite`, a real SQLite, so the store runs
 * against an actual engine rather than a hand-written fake that would only
 * ever agree with whatever the code already did.
 *
 * This does not cover SQLCipher. Node's build has no codec, so `PRAGMA key` is
 * an unknown pragma and SQLite ignores it. That is the silent-plaintext
 * failure mode worth knowing about, and why encryption has to be checked on a
 * device. Schema, migrations, upserts, ordering and limits are the real thing.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-sqlite-mock-'));
const open = new Map();
let cipherVersion = '4.6.1';

/** Files, not `:memory:`, so closing and reopening is a real round trip. */
function fileFor(name) {
  return path.join(root, name);
}

function wrap(db) {
  const wrapped = {
    async execAsync(sql) {
      db.exec(sql);
    },

    async runAsync(sql, ...params) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },

    async getFirstAsync(sql, ...params) {
      if (/^\s*PRAGMA\s+cipher_version/i.test(sql)) {
        return cipherVersion ? { cipher_version: cipherVersion } : null;
      }
      return db.prepare(sql).get(...params) ?? null;
    },

    async getAllAsync(sql, ...params) {
      return db.prepare(sql).all(...params);
    },

    async closeAsync() {
      db.close();
      for (const [name, entry] of open) if (entry.db === db) open.delete(name);
    },

    /** The raw handle, for a test that wants to look behind the store. */
    __db: db,
  };
  wrapped.withExclusiveTransactionAsync = async (task) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      await task(wrapped);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  };
  return wrapped;
}

async function openDatabaseAsync(name) {
  const existing = open.get(name);
  if (existing) return existing.wrapped;

  const db = new DatabaseSync(fileFor(name));
  const wrapped = wrap(db);
  open.set(name, { db, wrapped });
  return wrapped;
}

async function deleteDatabaseAsync(name) {
  const existing = open.get(name);
  if (existing) {
    try {
      existing.db.close();
    } catch {}
    open.delete(name);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(fileFor(name) + suffix);
    } catch {}
  }
}

module.exports = {
  openDatabaseAsync,
  openDatabaseSync: () => {
    throw new Error('openDatabaseSync is not used by this app; use openDatabaseAsync.');
  },
  deleteDatabaseAsync,
  /** Drops every database between suites. */
  __reset: async () => {
    for (const name of [...open.keys()]) await deleteDatabaseAsync(name);
    cipherVersion = '4.6.1';
  },
  __setCipherVersion: (version) => {
    cipherVersion = version;
  },
};
