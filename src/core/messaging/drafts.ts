import type { AccountStorage } from '@/storage/account';
import type { ConversationId, MessageId } from './types';

export type Drafts = Record<ConversationId, string>;

const KEY = 'chat.drafts';
const SAVE_DELAY_MS = 400;

let pending: {
  storage: AccountStorage;
  drafts: Drafts;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

export async function loadDrafts(storage: AccountStorage): Promise<Drafts> {
  return (await storage.get<Drafts>(KEY)) ?? {};
}

export function saveDraftsSoon(storage: AccountStorage, drafts: Drafts): void {
  if (pending && pending.storage !== storage) flushDrafts();
  if (pending) clearTimeout(pending.timer);
  pending = { storage, drafts, timer: setTimeout(flushDrafts, SAVE_DELAY_MS) };
}

export function flushDrafts(): void {
  if (!pending) return;
  const { storage, drafts, timer } = pending;
  pending = null;
  clearTimeout(timer);
  storage.set(KEY, drafts).catch((error) => console.warn('[chat] could not save drafts', error));
}

/** A thread keeps its own draft, on this device only. */
export function draftKey(id: ConversationId, thread?: MessageId): string {
  return thread ? `${id}#thread:${thread}` : id;
}

export function withDraft(drafts: Drafts, id: ConversationId, text: string): Drafts {
  const next = { ...drafts };
  if (text) next[id] = text;
  else delete next[id];
  return next;
}

const PUSH_DELAY_MS = 1_500;

/**
 * What the network last had is remembered, so its echo of our own save changes
 * nothing and a draft typed elsewhere replaces ours only while ours is unchanged.
 */
export class DraftSync {
  private readonly remote = new Map<ConversationId, string>();
  private readonly timers = new Map<ConversationId, ReturnType<typeof setTimeout>>();

  typed(id: ConversationId, text: string, push: (text: string) => Promise<void>): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        if ((this.remote.get(id) ?? '') === text) return;
        this.remote.set(id, text);
        push(text).catch((error) => console.warn('[chat] could not save the draft', error));
      }, PUSH_DELAY_MS)
    );
  }

  /** The draft to show now that the network reports `text`, if it should replace `local`. */
  received(id: ConversationId, text: string, local: string): string | undefined {
    const last = this.remote.get(id);
    this.remote.set(id, text);
    if (last === text || local === text || this.timers.has(id)) return undefined;
    return local === (last ?? '') ? text : undefined;
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.remote.clear();
  }
}

export const draftSync = new DraftSync();
