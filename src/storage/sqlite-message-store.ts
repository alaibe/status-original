import { HYDRATE_LIMIT } from '@/core/messaging/message-store';
import { matchesSearch, SEARCH_LIMIT } from '@/core/messaging/search';
import type {
  MessageStore,
  StoredConversation,
  StoredSearchHit,
} from '@/core/messaging/message-store';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  MessageContent,
  MessageId,
} from '@/core/messaging/types';
import {
  accountDatabaseGeneration,
  openAccountDatabase,
  runAccountDatabaseOperation,
} from './database';

type Database = Awaited<ReturnType<typeof openAccountDatabase>>;

interface ConversationRow {
  id: string;
  protocol_id: string;
  participants: string;
  title: string | null;
  created_at: number;
  hidden: number;
  routing_key: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  sent_at: number;
  from_me: number;
  status: string;
  content: string;
  reply_to: string | null;
}

export class SqliteMessageStore implements MessageStore {
  private readonly generation: number;

  constructor(private readonly accountId: string) {
    this.generation = accountDatabaseGeneration(accountId);
  }

  async loadConversations(protocolId: string): Promise<StoredConversation[]> {
    const rows = await this.operation((db) =>
      db.getAllAsync<ConversationRow>(
        'SELECT * FROM conversations WHERE protocol_id = ?',
        protocolId
      )
    );
    return rows.map(toConversation);
  }

  async loadMessages(
    conversationId: ConversationId,
    limit = HYDRATE_LIMIT,
    before?: { sentAt: number; id: MessageId }
  ) {
    const rows = await this.operation((db) =>
      before
        ? db.getAllAsync<MessageRow>(
            `SELECT * FROM messages
           WHERE conversation_id = ? AND (sent_at < ? OR (sent_at = ? AND id < ?))
           ORDER BY sent_at DESC, id DESC LIMIT ?`,
            conversationId,
            before.sentAt,
            before.sentAt,
            before.id,
            limit
          )
        : db.getAllAsync<MessageRow>(
            'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?',
            conversationId,
            limit
          )
    );

    return rows.map(toMessage).reverse();
  }

  async searchMessages(
    query: string,
    conversationId?: ConversationId,
    protocolId?: string
  ): Promise<StoredSearchHit[]> {
    const rows = await this.operation((db) =>
      db.getAllAsync<MessageRow & { protocol_id: string | null }>(
        `SELECT m.*, c.protocol_id FROM messages m
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE instr(lower(m.content), lower(?)) > 0
           AND (? IS NULL OR m.conversation_id = ?)
           AND (? IS NULL OR c.protocol_id = ?)
         ORDER BY m.sent_at DESC`,
        query,
        conversationId ?? null,
        conversationId ?? null,
        protocolId ?? null,
        protocolId ?? null
      )
    );
    const needle = query.toLowerCase();
    return rows
      .map((row) => ({ message: toMessage(row), protocolId: row.protocol_id ?? undefined }))
      .filter(({ message }) => matchesSearch(message, needle))
      .slice(0, SEARCH_LIMIT);
  }

  async countUnreadMessages(conversationId: ConversationId, since: number): Promise<number> {
    const row = await this.operation((db) =>
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ? AND sent_at > ? AND from_me = 0
           AND json_extract(content, '$.kind') NOT IN ('system', 'reaction')`,
        conversationId,
        since
      )
    );
    return row?.count ?? 0;
  }

  async upsertConversation(conversation: StoredConversation): Promise<void> {
    await this.write(async (db) => {
      await upsertConversation(db, conversation);
    });
  }

  async insertMessage(
    message: ChatMessage,
    conversation?: StoredConversation,
    transportTimestamp?: number
  ): Promise<boolean> {
    if (!conversation) return this.write((db) => insertMessage(db, message));
    return this.transaction(async (db) => {
      await upsertConversation(db, conversation);
      const inserted = await insertMessage(db, message);
      if (transportTimestamp !== undefined) {
        await db.runAsync(
          `INSERT INTO transport_cursors (protocol_id, conversation_id, timestamp)
             VALUES (?, ?, ?)
             ON CONFLICT(protocol_id, conversation_id) DO UPDATE SET
               timestamp = MAX(timestamp, excluded.timestamp)`,
          conversation.protocolId,
          conversation.id,
          transportTimestamp
        );
      }
      return inserted;
    });
  }

  async latestMessages(protocolId: string): Promise<Map<ConversationId, ChatMessage>> {
    const rows = await this.operation((db) =>
      db.getAllAsync<MessageRow>(
        `SELECT m.* FROM conversations c
       JOIN messages m ON m.rowid = (
         SELECT rowid FROM messages
         WHERE conversation_id = c.id
         ORDER BY sent_at DESC, id DESC LIMIT 1
       )
       WHERE c.protocol_id = ?`,
        protocolId
      )
    );
    return new Map(rows.map((row) => [row.conversation_id, toMessage(row)]));
  }

  async newestTransportTimestamp(
    protocolId: string,
    notAfter: number,
    conversationId?: ConversationId
  ): Promise<number | undefined> {
    const upperBound = Number.isFinite(notAfter) ? notAfter : Number.MAX_SAFE_INTEGER;
    const row = await this.operation((db) =>
      db.getFirstAsync<{ timestamp: number }>(
        `SELECT timestamp FROM transport_cursors
       WHERE protocol_id = ? AND timestamp <= ? AND (? IS NULL OR conversation_id = ?)
       ORDER BY timestamp DESC LIMIT 1`,
        protocolId,
        upperBound,
        conversationId ?? null,
        conversationId ?? null
      )
    );
    return row?.timestamp;
  }

  async clear(protocolId: string): Promise<void> {
    await this.transaction(async (db) => {
      await db.runAsync(
        `DELETE FROM messages WHERE conversation_id IN
           (SELECT id FROM conversations WHERE protocol_id = ?)`,
        protocolId
      );
      await db.runAsync('DELETE FROM transport_cursors WHERE protocol_id = ?', protocolId);
      await db.runAsync('DELETE FROM conversations WHERE protocol_id = ?', protocolId);
    });
  }

  async cachedConversations(): Promise<Conversation[]> {
    const rows = await this.operation((db) =>
      db.getAllAsync<{ data: string }>('SELECT data FROM conversation_cache')
    );
    return rows.flatMap((row) => {
      try {
        const conversation = JSON.parse(row.data) as Conversation;
        return typeof conversation?.id === 'string' ? [conversation] : [];
      } catch {
        return [];
      }
    });
  }

  async cacheConversations(keep: Conversation[], drop: ConversationId[]): Promise<void> {
    await this.transaction(async (db) => {
      for (const rows of chunks(keep, CACHE_ROWS_PER_STATEMENT)) {
        await db.runAsync(
          `INSERT INTO conversation_cache (id, data)
             VALUES ${rows.map(() => '(?, ?)').join(', ')}
             ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
          ...rows.flatMap((conversation) => [conversation.id, JSON.stringify(conversation)])
        );
      }
      for (const ids of chunks(drop, CACHE_ROWS_PER_STATEMENT)) {
        await db.runAsync(
          `DELETE FROM conversation_cache WHERE id IN (${ids.map(() => '?').join(', ')})`,
          ...ids
        );
      }
    });
  }

  private transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return this.write(async (db) => {
      let result!: T;
      await db.withExclusiveTransactionAsync(async (transaction) => {
        result = await work(transaction as Database);
      });
      return result;
    });
  }

  private async write<T>(work: (db: Database) => Promise<T>) {
    return this.operation(work);
  }

  private operation<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return runAccountDatabaseOperation(this.accountId, this.generation, work);
  }
}

async function upsertConversation(db: Database, conversation: StoredConversation): Promise<void> {
  await db.runAsync(
    `INSERT INTO conversations
         (id, protocol_id, participants, title, created_at, hidden, routing_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         participants = excluded.participants,
         title        = excluded.title,
         created_at   = excluded.created_at,
         hidden       = excluded.hidden,
         routing_key  = excluded.routing_key`,
    conversation.id,
    conversation.protocolId,
    JSON.stringify(conversation.participants),
    conversation.title ?? null,
    conversation.createdAt,
    conversation.hidden ? 1 : 0,
    conversation.routingKey ?? null
  );
}

async function insertMessage(db: Database, message: ChatMessage): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO messages
         (id, conversation_id, sender_id, sent_at, from_me, status, content, reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, id) DO NOTHING`,
    message.id,
    message.conversationId,
    message.senderId,
    message.sentAt,
    message.fromMe ? 1 : 0,
    message.status,
    JSON.stringify(message.content),
    message.replyTo ?? null
  );
  return result.changes === 1;
}

function toConversation(row: ConversationRow): StoredConversation {
  return {
    id: row.id,
    protocolId: row.protocol_id,
    participants: parseArray(row.participants),
    title: row.title ?? undefined,
    createdAt: row.created_at,
    hidden: row.hidden === 1,
    routingKey: row.routing_key ?? undefined,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sentAt: row.sent_at,
    content: parseContent(row.content),
    fromMe: row.from_me === 1,
    status: row.status as ChatMessage['status'],
    replyTo: row.reply_to ?? undefined,
    privateToMe: (row.sender_id === 'local' && row.id.startsWith('private:')) || undefined,
  };
}

function parseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseContent(raw: string): MessageContent {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') {
      return parsed as MessageContent;
    }
  } catch {}
  return {
    kind: 'unsupported',
    typeId: 'unknown',
    fallback: 'This message could not be read.',
  };
}

const CACHE_ROWS_PER_STATEMENT = 300;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
