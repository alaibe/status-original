import { dropConversations } from './chat-store';
import type { MessageStore } from './message-store';
import type { Conversation, ConversationId } from './types';

const SAVE_DELAY_MS = 2_000;

function lasting({
  typing: _typing,
  online: _online,
  lastSeenAt: _lastSeenAt,
  draft: _draft,
  ...rest
}: Conversation): Conversation {
  return rest;
}

/**
 * The chat list as each network last listed it in full, shown at launch
 * before any network connects. A network's chats are written only once it has
 * listed everything, and a restored chat its full listing lacks is dropped.
 */
export class ConversationCache {
  private readonly written = new Map<
    ConversationId,
    { protocol: string; source: Conversation; json?: string }
  >();
  private readonly restored = new Map<ConversationId, string>();
  private readonly complete = new Set<string>();
  private pending: Conversation[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: MessageStore) {}

  async restore(): Promise<Conversation[]> {
    const cached = await this.store.cachedConversations().catch(() => []);
    return cached.filter((conversation) => {
      const protocol = conversation.protocol;
      if (!protocol) return false;
      this.written.set(conversation.id, { protocol, source: conversation });
      this.restored.set(conversation.id, protocol);
      return true;
    });
  }

  listed(protocol: string, conversations: Conversation[]): void {
    this.complete.add(protocol);
    const present = new Set(conversations.map((conversation) => conversation.id));
    this.release(protocol, (id) => !present.has(id));
  }

  forget(protocol: string): void {
    this.complete.delete(protocol);
    const drop = [...this.written].filter(([, row]) => row.protocol === protocol).map(([id]) => id);
    for (const id of drop) this.written.delete(id);
    if (drop.length > 0) {
      this.store
        .cacheConversations([], drop)
        .catch((error) => console.warn('[chat] could not forget cached chats', error));
    }
    this.release(protocol, () => true);
  }

  pause(protocol: string): void {
    this.complete.delete(protocol);
  }

  saveSoon(conversations: Conversation[]): void {
    this.pending = conversations;
    this.timer ??= setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const conversations = this.pending;
    this.pending = null;
    if (!conversations) return;

    for (const protocol of this.complete) {
      const keep: Conversation[] = [];
      const present = new Set<ConversationId>();
      for (const conversation of conversations) {
        if (conversation.protocol !== protocol) continue;
        present.add(conversation.id);
        const written = this.written.get(conversation.id);
        if (written?.source === conversation) continue;
        const row = lasting(conversation);
        const json = JSON.stringify(row);
        this.written.set(conversation.id, { protocol, source: conversation, json });
        if (written && (written.json ?? JSON.stringify(written.source)) === json) continue;
        keep.push(row);
      }
      const drop = [...this.written]
        .filter(([id, row]) => row.protocol === protocol && !present.has(id))
        .map(([id]) => id);
      for (const id of drop) this.written.delete(id);
      if (keep.length === 0 && drop.length === 0) continue;
      await this.store
        .cacheConversations(keep, drop)
        .catch((error) => console.warn('[chat] could not keep the chat list', error));
    }
  }

  private release(protocol: string, stale: (id: ConversationId) => boolean): void {
    const dropped: ConversationId[] = [];
    for (const [id, owner] of [...this.restored]) {
      if (owner !== protocol) continue;
      this.restored.delete(id);
      if (stale(id)) dropped.push(id);
    }
    dropConversations(dropped);
  }
}
