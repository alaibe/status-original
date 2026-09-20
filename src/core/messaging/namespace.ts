/**
 * Conversation ids carry their own routing, `<protocol>-<native id>`. This is
 * what lets one inbox hold three transports without anything downstream
 * filtering by protocol.
 */
import { LOCAL_PREFIX } from './bots';
import type { ChatMessage, Conversation, ConversationId } from './types';

export type ProtocolId = string;

export const PROTOCOL_ID = /^[a-z][a-z0-9]*$/;
export const NATIVE_ID = /^[A-Za-z0-9_-]+$/;

export const LOCAL_PROTOCOL: ProtocolId = LOCAL_PREFIX.slice(0, -1);

export function namespacedId(protocol: ProtocolId, nativeId: string): ConversationId {
  if (!PROTOCOL_ID.test(protocol)) {
    throw new Error(`Protocol id "${protocol}" must be lowercase alphanumeric with no hyphen`);
  }
  if (!NATIVE_ID.test(nativeId)) {
    throw new Error(
      `Conversation id "${nativeId}" is not URL-safe. ` +
        'Adapters must hash ids outside [A-Za-z0-9_-] before returning them.'
    );
  }
  return `${protocol}-${nativeId}`;
}

export interface SplitId {
  protocol: ProtocolId;
  nativeId: string;
}

export function splitConversationId(id: ConversationId): SplitId | null {
  const at = id.indexOf('-');
  if (at <= 0) return null;

  const protocol = id.slice(0, at);
  const nativeId = id.slice(at + 1);
  if (!PROTOCOL_ID.test(protocol) || nativeId.length === 0) return null;
  return { protocol, nativeId };
}

export function protocolOf(id: ConversationId): ProtocolId | null {
  return splitConversationId(id)?.protocol ?? null;
}

export function namespaceMessage(protocol: ProtocolId, message: ChatMessage): ChatMessage {
  return {
    ...message,
    conversationId: namespacedId(protocol, message.conversationId),
  };
}

export function namespaceConversation(
  protocol: ProtocolId,
  conversation: Conversation
): Conversation {
  return {
    ...conversation,
    id: namespacedId(protocol, conversation.id),
    protocol,
    lastMessage: conversation.lastMessage
      ? namespaceMessage(protocol, conversation.lastMessage)
      : undefined,
  };
}
