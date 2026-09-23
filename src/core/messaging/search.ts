import { isLocalConversation } from './bots';
import type { MessageStore } from './message-store';
import { namespaceMessage, splitConversationId } from './namespace';
import { contentPreview } from './preview';
import type { ChatSession } from './protocol';
import type { ChatMessage, ConversationId } from './types';

export const SEARCH_LIMIT = 100;

export function matchesSearch(message: ChatMessage, needle: string): boolean {
  return contentPreview(message.content).toLowerCase().includes(needle);
}

interface Searchable {
  messageStore: MessageStore | null;
  messages: Record<ConversationId, ChatMessage[]>;
  sessions: Record<string, ChatSession>;
}

export async function searchMessages(
  state: Searchable,
  query: string,
  id?: ConversationId
): Promise<ChatMessage[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const split = id && !isLocalConversation(id) ? splitConversationId(id) : null;
  const store = state.messageStore;
  // Private notes sit under the namespaced id, network history under the native one.
  const local = store
    ? Promise.all([
        store.searchMessages(needle, split?.nativeId ?? id, split?.protocol),
        split ? store.searchMessages(needle, id) : [],
      ]).then((hits) => hits.flat())
    : Promise.resolve([]);
  const loaded = Object.entries(state.messages)
    .filter(([conversationId]) => !id || conversationId === id)
    .flatMap(([, messages]) => messages)
    .filter((message) => matchesSearch(message, needle));
  const protocols = id ? (split ? [split.protocol] : []) : Object.keys(state.sessions);
  const network = protocols.map(async (protocol) => {
    const session = state.sessions[protocol];
    if (!session?.searchMessages) return [];
    const found = await session
      .searchMessages(needle, id ? split?.nativeId : undefined)
      .catch((error: unknown) => {
        console.warn(`[chat] ${protocol} search failed`, error);
        return [];
      });
    return found.map((message) => namespaceMessage(protocol, message));
  });
  const stored = (await local).map(({ message, protocolId }) =>
    protocolId && !isLocalConversation(message.conversationId)
      ? namespaceMessage(protocolId, message)
      : message
  );
  const results = [...stored, ...loaded, ...(await Promise.all(network)).flat()].filter(
    (message) => !id || message.conversationId === id
  );
  const unique = new Map(
    results.map((message) => [`${message.conversationId}:${message.id}`, message])
  );
  return [...unique.values()].sort((a, b) => b.sentAt - a.sentAt).slice(0, SEARCH_LIMIT);
}
