import type { Conversation } from '@/core/messaging/types';

import { headerSubtitle } from './header-subtitle';

jest.mock('@/features/protocols/presentation', () => ({
  protocolSubtitle: (protocol?: string) => (protocol === 'telegram' ? 'Telegram' : 'Status'),
}));

const chat = (over: Partial<Conversation>): Conversation => ({
  id: 'c1',
  kind: 'group',
  title: 'Builders',
  memberIds: ['a', 'b', 'c'],
  createdAt: 0,
  consent: 'allowed',
  protocol: 'telegram',
  ...over,
});

describe('headerSubtitle', () => {
  it('puts typing first, then presence in a DM', () => {
    expect(headerSubtitle(chat({ kind: 'dm', typing: true, online: true }))).toBe('typing…');
    expect(headerSubtitle(chat({ kind: 'dm', online: true }))).toBe('online');
    expect(headerSubtitle(chat({ kind: 'dm', lastSeenAt: Date.now() }))).toMatch(/^last seen /);
  });

  it('tells an admin people are waiting to join', () => {
    expect(headerSubtitle(chat({ pendingJoinRequests: 1 }))).toBe('1 join request');
    expect(headerSubtitle(chat({ pendingJoinRequests: 3, kind: 'channel' }))).toBe(
      '3 join requests'
    );
  });

  it('otherwise says what kind of chat it is and where', () => {
    expect(headerSubtitle(chat({}))).toBe('3 members · Telegram');
    expect(headerSubtitle(chat({ kind: 'channel' }))).toBe('Channel · Telegram');
    expect(headerSubtitle(chat({ kind: 'dm' }))).toBe('Telegram');
  });
});
