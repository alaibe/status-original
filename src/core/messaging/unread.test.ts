import type { ChatMessage, Conversation } from './types';

import { isUnread, totalUnread, unreadCount } from './unread';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: 'peer',
  sentAt: 1_000,
  content: { kind: 'text', text: 'hi' },
  fromMe: false,
  status: 'sent',
  ...overrides,
});

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  kind: 'dm',
  title: 'Alice',
  memberIds: [],
  createdAt: 0,
  consent: 'allowed',
  lastMessage: message(),
  ...overrides,
});

describe('isUnread', () => {
  it('is unread when the last message arrived after it was read', () => {
    expect(isUnread(conversation(), { c1: 500 })).toBe(true);
  });

  it('is read once opened after the message', () => {
    expect(isUnread(conversation(), { c1: 1_500 })).toBe(false);
  });

  it('treats a never-opened conversation with a message as unread', () => {
    expect(isUnread(conversation(), {})).toBe(true);
  });

  it('never counts your own message, because sending is reading', () => {
    expect(isUnread(conversation({ lastMessage: message({ fromMe: true }) }), {})).toBe(false);
  });

  it('ignores membership changes, which are not something to read', () => {
    const system = message({ content: { kind: 'system', text: '1 joined' } });
    expect(isUnread(conversation({ lastMessage: system }), {})).toBe(false);
  });

  it('is not unread when there are no messages at all', () => {
    expect(isUnread(conversation({ lastMessage: undefined }), {})).toBe(false);
  });
});

describe('totalUnread', () => {
  it('counts conversations, not messages, because that is what a badge means', () => {
    const conversations = [
      conversation({ id: 'c1', lastMessage: message({ sentAt: 1_000 }) }),
      conversation({ id: 'c2', lastMessage: message({ sentAt: 2_000 }) }),
      conversation({ id: 'c3', lastMessage: message({ fromMe: true, sentAt: 3_000 }) }),
    ];
    expect(totalUnread(conversations, { c1: 5_000 }, {})).toBe(1);
  });

  it('leaves muted conversations out', () => {
    const conversations = [conversation({ id: 'c1' }), conversation({ id: 'c2' })];
    expect(totalUnread(conversations, {}, { c2: { muted: true } })).toBe(1);
  });
});

describe('unreadCount', () => {
  it('counts what others sent since the chat was read, by the same rule as isUnread', () => {
    const messages = [
      message({ id: 'old', sentAt: 500 }),
      message({ id: 'new', sentAt: 1_500 }),
      message({ id: 'mine', sentAt: 1_600, fromMe: true }),
      message({ id: 'system', sentAt: 1_700, content: { kind: 'system', text: 'joined' } }),
      message({ id: 'newer', sentAt: 1_800 }),
    ];
    expect(unreadCount(messages, 1_000)).toBe(2);
    expect(unreadCount(messages, 2_000)).toBe(0);
  });
});
