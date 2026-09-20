import type { AccountStorage } from '@/storage/account';
import type { ConversationId } from './types';

export type ReadState = Record<ConversationId, number>;

const KEY = 'chat.readAt';

export async function readReadState(storage: AccountStorage): Promise<ReadState> {
  return (await storage.get<ReadState>(KEY)) ?? {};
}

export async function writeReadState(storage: AccountStorage, readAt: ReadState): Promise<void> {
  try {
    await storage.set(KEY, readAt);
  } catch (error) {
    console.warn('[chat] could not save read state', error);
  }
}
