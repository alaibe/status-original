import type { ChatMessage, Conversation } from '../messaging/types';
import { arrivals } from './use-notifications';

const SINCE = 1_000;

function message(id: string, sentAt: number): ChatMessage {
  return {
    id,
    conversationId: 'telegram-1',
    senderId: 'peer',
    sentAt,
    content: { kind: 'text', text: id },
    fromMe: false,
    status: 'sent',
  };
}

function chat(lastMessage?: ChatMessage, extra: Partial<Conversation> = {}): Conversation {
  return {
    id: 'telegram-1',
    kind: 'dm',
    title: 'Bob',
    memberIds: [],
    createdAt: 0,
    consent: 'allowed',
    lastMessage,
    ...extra,
  };
}

describe('arrivals', () => {
  it('reports a message that replaced an older one', () => {
    const next = chat(message('b', 2_000));
    expect(arrivals([chat(message('a', 1_500))], [next], SINCE)).toEqual([
      { conversation: next, message: next.lastMessage },
    ]);
  });

  it('ignores the same message announced again, as a presence or typing update does', () => {
    const before = chat(message('a', 2_000));
    const after = chat({ ...message('a', 2_000) }, { typing: true });
    expect(arrivals([before], [after], SINCE)).toEqual([]);
  });

  it('ignores chats listed at launch with messages from before it', () => {
    expect(arrivals([], [chat(message('a', 500))], SINCE)).toEqual([]);
  });

  it('reports a new chat that starts with a new message', () => {
    expect(arrivals([], [chat(message('a', 2_000))], SINCE)).toHaveLength(1);
  });

  it('ignores the older message a deletion brings back', () => {
    expect(arrivals([chat(message('b', 3_000))], [chat(message('a', 2_000))], SINCE)).toEqual([]);
  });
});
