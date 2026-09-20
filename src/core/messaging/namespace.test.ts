import { botConversationId, isLocalConversation, STATUS_LOCAL_ID } from './bots';
import {
  LOCAL_PROTOCOL,
  NATIVE_ID,
  namespaceConversation,
  namespacedId,
  namespaceMessage,
  protocolOf,
  splitConversationId,
} from './namespace';
import type { ChatMessage, Conversation } from './types';

describe('namespacedId', () => {
  it('round-trips through splitConversationId', () => {
    const id = namespacedId('nostr', 'abc123');
    expect(id).toBe('nostr-abc123');
    expect(splitConversationId(id)).toEqual({ protocol: 'nostr', nativeId: 'abc123' });
  });

  it('splits on the first hyphen, so a native id may contain its own', () => {
    // XMTP ids are hex, but the fake sessions and any future transport may not
    // be. Getting this wrong routes `xmtp-dm-abc` to a protocol called
    // "xmtp-dm", which does not exist.
    expect(splitConversationId('xmtp-dm-abc')).toEqual({
      protocol: 'xmtp',
      nativeId: 'dm-abc',
    });
  });

  it('refuses a native id that would not survive a URL path segment', () => {
    // This is the bug the whole module exists to prevent: a conversation id
    // becomes `/chat/<id>`, and a slash or colon silently fails to route.
    expect(() => namespacedId('waku', '/waku/2/rs/1/0')).toThrow(/URL-safe/);
    expect(() => namespacedId('nostr', 'a:b')).toThrow(/URL-safe/);
  });

  it('refuses a protocol id containing a hyphen, which would be ambiguous', () => {
    expect(() => namespacedId('my-protocol', 'abc')).toThrow(/no hyphen/);
  });

  it('returns null for an id with no recognisable prefix', () => {
    // An id minted before namespacing existed. Guessing a protocol would send
    // one transport's message down another's wire.
    expect(splitConversationId('a'.repeat(64))).toBeNull();
    expect(protocolOf('a'.repeat(64))).toBeNull();
  });
});

describe('local conversations', () => {
  it('parse as the reserved "local" protocol without a special case', () => {
    // bots.ts chose `local-` for the same URL-safety reason; this keeps the
    // two consistent rather than making every caller test for both.
    expect(LOCAL_PROTOCOL).toBe('local');
    expect(protocolOf(STATUS_LOCAL_ID)).toBe('local');
    expect(isLocalConversation(botConversationId('status'))).toBe(true);
  });

  it('produces bot ids that are themselves valid native ids', () => {
    expect(NATIVE_ID.test('status')).toBe(true);
  });
});

describe('projection', () => {
  const message: ChatMessage = {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'p1',
    sentAt: 10,
    content: { kind: 'text', text: 'hi' },
    fromMe: false,
    status: 'sent',
  };

  it('rewrites a message conversation id', () => {
    expect(namespaceMessage('nostr', message).conversationId).toBe('nostr-c1');
  });

  it('rewrites a conversation and its preview, and stamps the protocol', () => {
    const conversation: Conversation = {
      id: 'c1',
      kind: 'dm',
      title: 'Alice',
      memberIds: ['p1'],
      createdAt: 1,
      consent: 'allowed',
      lastMessage: message,
    };

    const namespaced = namespaceConversation('waku', conversation);
    expect(namespaced.id).toBe('waku-c1');
    expect(namespaced.protocol).toBe('waku');
    // The preview has to be rewritten too; the chat list keys rows off it.
    expect(namespaced.lastMessage?.conversationId).toBe('waku-c1');
  });
});
