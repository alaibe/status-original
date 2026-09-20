import { deleteAccountDatabase, openAccountDatabase } from './database';
import { SqliteMessageStore } from './sqlite-message-store';
import type { ChatMessage } from '@/core/messaging/types';

const WAKU = 'waku';
const NOSTR = 'nostr';

let account = 0;
const accounts = new Set<string>();

function freshAccount(): string {
  account += 1;
  const id = `acct-${account}`;
  accounts.add(id);
  return id;
}

async function deleteTestDatabase(id: string): Promise<void> {
  await deleteAccountDatabase(id);
  accounts.delete(id);
}

afterEach(async () => {
  await Promise.all([...accounts].map(deleteAccountDatabase));
  accounts.clear();
});

function message(over: Partial<ChatMessage> & { id: string; conversationId: string }): ChatMessage {
  return {
    senderId: 'them',
    sentAt: 1000,
    content: { kind: 'text', text: 'hello' },
    fromMe: false,
    status: 'sent',
    ...over,
  };
}

function conversation(id: string, protocolId = WAKU, over: Record<string, unknown> = {}) {
  return {
    id,
    protocolId,
    participants: ['me', 'them'],
    createdAt: 5000,
    hidden: false,
    ...over,
  };
}

describe('the schema', () => {
  it('fails closed when SQLCipher is unavailable and can retry', async () => {
    const id = freshAccount();
    const sqlite = jest.requireMock('expo-sqlite') as {
      __setCipherVersion(version: string): void;
    };
    sqlite.__setCipherVersion('');

    await expect(openAccountDatabase(id)).rejects.toThrow('SQLCipher is unavailable');

    sqlite.__setCipherVersion('4.6.1');
    await expect(openAccountDatabase(id)).resolves.toBeDefined();
  });

  it('creates itself on first open and records its version', async () => {
    const id = freshAccount();
    const db = await openAccountDatabase(id);

    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(2);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['conversations', 'messages', 'transport_cursors']),
    );
  });

  it('does not re-run the migration on a second open', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));

    const reopened = new SqliteMessageStore(id);
    expect(await reopened.loadConversations(WAKU)).toHaveLength(1);
  });
});

describe('conversations', () => {
  it('round-trips every field, including the ones that are easy to drop', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);

    await store.upsertConversation(
      conversation('c1', WAKU, {
        title: 'Duo',
        routingKey: '/app/1/chat/proto',
        participants: ['a', 'b', 'c'],
        hidden: true,
      }),
    );

    const [loaded] = await store.loadConversations(WAKU);
    expect(loaded).toEqual({
      id: 'c1',
      protocolId: WAKU,
      participants: ['a', 'b', 'c'],
      title: 'Duo',
      createdAt: 5000,
      hidden: true,
      routingKey: '/app/1/chat/proto',
    });
  });

  it('updates in place rather than inserting a second row', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);

    await store.upsertConversation(conversation('c1', WAKU, { title: 'First' }));
    await store.upsertConversation(conversation('c1', WAKU, { title: 'Renamed', hidden: true }));

    const loaded = await store.loadConversations(WAKU);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('Renamed');
    expect(loaded[0].hidden).toBe(true);
  });

  it('keeps protocols apart', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);

    await store.upsertConversation(conversation('c1', WAKU));
    await store.upsertConversation(conversation('c2', NOSTR));

    expect((await store.loadConversations(WAKU)).map((c) => c.id)).toEqual(['c1']);
    expect((await store.loadConversations(NOSTR)).map((c) => c.id)).toEqual(['c2']);
  });
});

describe('messages', () => {
  it('rolls back conversation metadata when an atomic ingest fails', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    const db = await openAccountDatabase(id);
    const run = db.runAsync.bind(db);
    jest.spyOn(db, 'runAsync').mockImplementation(async (sql, ...params) => {
      if (sql.includes('INSERT INTO messages')) throw new Error('disk full');
      return run(sql, ...params);
    });

    await expect(store.insertMessage(
      message({ id: 'm1', conversationId: 'c1' }),
      conversation('c1'),
    )).rejects.toThrow('disk full');

    expect(await store.loadConversations(WAKU)).toEqual([]);
    expect(await store.loadMessages('c1')).toEqual([]);
  });

  it('does not expose conversation metadata before its message commits', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    const db = await openAccountDatabase(id);
    const run = db.runAsync.bind(db);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    jest.spyOn(db, 'runAsync').mockImplementation(async (sql, ...params) => {
      if (sql.includes('INSERT INTO messages')) {
        reached();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return run(sql, ...params);
    });

    const ingesting = store.insertMessage(message({ id: 'm1', conversationId: 'c1' }), conversation('c1'));
    await paused;
    let readFinished = false;
    const reading = store.loadConversations(WAKU).then((rows) => {
      readFinished = true;
      return rows;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    release();

    await expect(ingesting).resolves.toBe(true);
    await expect(reading).resolves.toHaveLength(1);
    await expect(store.loadMessages('c1')).resolves.toHaveLength(1);
  });

  it('persists transport timestamps independently from sender timestamps', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.insertMessage(
      message({ id: 'm1', conversationId: 'c1', sentAt: 99_000 }),
      conversation('c1'),
      2_000,
    );

    expect((await store.latestMessages(WAKU)).get('c1')?.sentAt).toBe(99_000);
    await expect(store.newestTransportTimestamp(WAKU, Number.POSITIVE_INFINITY, 'c1')).resolves.toBe(2_000);
  });

  it('returns them oldest first, the order the transcript renders', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));

    await store.insertMessage(message({ id: 'm2', conversationId: 'c1', sentAt: 2000 }));
    await store.insertMessage(message({ id: 'm1', conversationId: 'c1', sentAt: 1000 }));
    await store.insertMessage(message({ id: 'm3', conversationId: 'c1', sentAt: 3000 }));

    expect((await store.loadMessages('c1')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('takes the NEWEST n when limited, not the oldest', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));

    for (let i = 1; i <= 10; i++) {
      await store.insertMessage(message({ id: `m${i}`, conversationId: 'c1', sentAt: i * 1000 }));
    }

    expect((await store.loadMessages('c1', 3)).map((m) => m.id)).toEqual(['m8', 'm9', 'm10']);
  });

  it('loads the page immediately before a message cursor', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    for (let i = 1; i <= 6; i++) {
      await store.insertMessage(message({ id: `m${i}`, conversationId: 'c1', sentAt: i * 1000 }));
    }

    const loaded = await store.loadMessages('c1', 2, { id: 'm5', sentAt: 5000 });
    expect(loaded.map((entry) => entry.id)).toEqual(['m3', 'm4']);
  });

  it('ignores the same message saved twice', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));

    await expect(store.insertMessage(message({ id: 'm1', conversationId: 'c1' }))).resolves.toBe(true);
    await expect(store.insertMessage(message({ id: 'm1', conversationId: 'c1' }))).resolves.toBe(false);

    expect(await store.loadMessages('c1')).toHaveLength(1);
  });

  it('projects the latest message without loading a transcript window', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.insertMessage(message({ id: 'old', conversationId: 'c1', sentAt: 1_000 }));
    await store.insertMessage(message({ id: 'new', conversationId: 'c1', sentAt: 2_000 }));

    expect((await store.loadMessages('c1', 1))[0]?.id).toBe('new');
  });

  it('projects every conversation’s latest message in one query', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.upsertConversation(conversation('c2'));
    await store.upsertConversation(conversation('empty'));
    await store.upsertConversation(conversation('other', NOSTR));
    await store.insertMessage(message({ id: 'one', conversationId: 'c1', sentAt: 1_000 }));
    await store.insertMessage(message({ id: 'a', conversationId: 'c1', sentAt: 5_000 }));
    await store.insertMessage(message({ id: 'b', conversationId: 'c1', sentAt: 5_000 }));
    await store.insertMessage(message({ id: 'two', conversationId: 'c2', sentAt: 2_000 }));
    await store.insertMessage(message({ id: 'n', conversationId: 'other', sentAt: 9_000 }));

    const latest = await store.latestMessages(WAKU);

    expect([...latest.keys()].sort()).toEqual(['c1', 'c2']);
    // The same tie-break as loadMessages, so the two agree on the newest row.
    expect(latest.get('c1')?.id).toBe((await store.loadMessages('c1', 1))[0].id);
    expect(latest.get('c1')?.id).toBe('b');
    expect(latest.get('c2')?.id).toBe('two');
  });

  it('does not let a duplicate overwrite the canonical event', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.insertMessage(message({ id: 'm1', conversationId: 'c1' }));
    await store.insertMessage(message({
      id: 'm1',
      conversationId: 'c1',
      content: { kind: 'text', text: 'tampered' },
    }));

    expect((await store.loadMessages('c1'))[0].content).toEqual({ kind: 'text', text: 'hello' });
  });

  it('round-trips private command output', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.insertMessage(message({
      id: 'private:1',
      conversationId: 'xmtp-c1',
      senderId: 'local',
      privateToMe: true,
    }));

    expect((await store.loadMessages('xmtp-c1'))[0].privateToMe).toBe(true);
  });

  it('lets the same id exist in two conversations', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.upsertConversation(conversation('c2'));

    await store.insertMessage(message({ id: 'same', conversationId: 'c1' }));
    await store.insertMessage(message({ id: 'same', conversationId: 'c2' }));

    expect(await store.loadMessages('c1')).toHaveLength(1);
    expect(await store.loadMessages('c2')).toHaveLength(1);
  });

  it('round-trips a non-text content type intact', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));

    await store.insertMessage(
      message({
        id: 'm1',
        conversationId: 'c1',
        fromMe: true,
        replyTo: 'm0',
        content: { kind: 'image', uri: 'file:///a.png', width: 10, height: 20, caption: 'hi' },
      }),
    );

    const [loaded] = await store.loadMessages('c1');
    expect(loaded.content).toEqual({
      kind: 'image',
      uri: 'file:///a.png',
      width: 10,
      height: 20,
      caption: 'hi',
    });
    expect(loaded.fromMe).toBe(true);
    expect(loaded.replyTo).toBe('m0');
  });

  it('renders a row it cannot parse rather than throwing', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.insertMessage(message({ id: 'm1', conversationId: 'c1' }));

    const db = await openAccountDatabase(id);
    await db.runAsync("UPDATE messages SET content = 'not json' WHERE id = 'm1'");

    const [loaded] = await store.loadMessages('c1');
    expect(loaded.content.kind).toBe('unsupported');
  });
});

describe('clearing', () => {
  it('erases one protocol and leaves the other alone', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);

    await store.upsertConversation(conversation('c1', WAKU));
    await store.upsertConversation(conversation('c2', NOSTR));
    await store.insertMessage(message({ id: 'm1', conversationId: 'c1' }));
    await store.insertMessage(message({ id: 'm2', conversationId: 'c2' }));

    await store.clear(WAKU);

    expect(await store.loadConversations(WAKU)).toEqual([]);
    expect(await store.loadMessages('c1')).toEqual([]);
    expect(await store.loadConversations(NOSTR)).toHaveLength(1);
    expect(await store.loadMessages('c2')).toHaveLength(1);
  });

  it('leaves nothing behind when the database is deleted', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    await store.upsertConversation(conversation('c1'));
    await store.insertMessage(message({ id: 'm1', conversationId: 'c1' }));

    await deleteTestDatabase(id);

    const after = new SqliteMessageStore(id);
    expect(await after.loadConversations(WAKU)).toEqual([]);
  });

  it('blocks new writes and waits for the account queue before deletion', async () => {
    const id = freshAccount();
    const store = new SqliteMessageStore(id);
    const db = await openAccountDatabase(id);
    const run = db.runAsync.bind(db);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    jest.spyOn(db, 'runAsync').mockImplementation(async (sql, ...params) => {
      if (sql.includes('INSERT INTO conversations')) {
        reached();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return run(sql, ...params);
    });

    const writing = store.upsertConversation(conversation('c1'));
    await paused;
    const deleting = deleteAccountDatabase(id);
    await expect(store.upsertConversation(conversation('c2'))).rejects.toThrow(/being deleted/);
    let deleted = false;
    void deleting.then(() => { deleted = true; });
    await Promise.resolve();
    expect(deleted).toBe(false);
    release();
    await writing;
    await deleting;
    await expect(store.upsertConversation(conversation('late'))).rejects.toThrow(/has been deleted/);
    accounts.delete(id);
  });

  it('keeps two accounts in separate databases', async () => {
    const a = freshAccount();
    const b = freshAccount();

    await new SqliteMessageStore(a).upsertConversation(conversation('c1'));
    await new SqliteMessageStore(b).upsertConversation(conversation('c2'));

    await deleteTestDatabase(a);

    expect((await new SqliteMessageStore(b).loadConversations(WAKU)).map((c) => c.id)).toEqual([
      'c2',
    ]);
  });
});
