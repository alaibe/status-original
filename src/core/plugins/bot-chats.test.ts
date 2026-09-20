import { botConversationId, type Bot } from '../messaging/bots';
import type { ChatMessage, ConversationId } from '../messaging/types';
import { botChatLoss, botChatLossCopy } from './bot-chats';

const BOT: Bot = {
  id: 'markets',
  name: 'Markets',
  tagline: 'test',
  greeting: () => ['Welcome.', 'Set one with /alert.'],
};

const ID = botConversationId(BOT.id);

function message(text: string, fromMe: boolean): ChatMessage {
  return {
    id: `${text}:${fromMe}`,
    conversationId: ID,
    senderId: fromMe ? 'me' : BOT.id,
    sentAt: 0,
    content: { kind: 'text', text },
    fromMe,
    status: 'sent',
  };
}

const transcript = (...messages: ChatMessage[]): Record<ConversationId, ChatMessage[]> => ({
  [ID]: messages,
});

describe('what a plugin toggle costs', () => {
  it('says nothing about a chat the user never used', () => {
    // Warning about a two-line greeting would train the user to dismiss the
    // warning, which is worse than not showing one.
    const greeting = transcript(message('Welcome.', false), message('Set one with /alert.', false));
    expect(botChatLoss([BOT], greeting)).toBeNull();
  });

  it('says nothing about a plugin with no bots at all', () => {
    expect(botChatLoss([], transcript(message('hi', true)))).toBeNull();
  });

  it('warns once the user has written in it', () => {
    const loss = botChatLoss([BOT], transcript(message('Welcome.', false), message('hi', true)));

    expect(loss).toMatchObject({ botNames: ['Markets'], fromYou: 1, total: 2 });
    expect(loss?.conversationIds).toEqual([ID]);
  });

  it('warns about history the bot itself accumulated', () => {
    // The motivating case: a month of confirmations the user never replied to
    // is exactly the history a switch must not silently empty.
    const loss = botChatLoss(
      [BOT],
      transcript(
        message('Welcome.', false),
        message('Set one with /alert.', false),
        message('BTC crossed 100000.', false)
      )
    );

    expect(loss).toMatchObject({ fromYou: 0, total: 3 });
  });

  it('adds up across every bot the plugin owns', () => {
    const second: Bot = { ...BOT, id: 'markets-news', name: 'Market news' };
    const loss = botChatLoss([BOT, second], {
      [ID]: [message('hi', true)],
      [botConversationId(second.id)]: [message('news', false), message('thanks', true)],
    });

    expect(loss).toMatchObject({ botNames: ['Markets', 'Market news'], fromYou: 2, total: 3 });
  });
});

describe('the words shown before the switch moves', () => {
  it('names the chat, counts the messages, and promises they come back', () => {
    const loss = botChatLoss([BOT], transcript(message('Welcome.', false), message('hi', true)))!;
    const copy = botChatLossCopy('Markets', loss);

    expect(copy.title).toBe('Turn off Markets?');
    expect(copy.body).toContain('Markets');
    expect(copy.body).toContain('2 messages');
    expect(copy.body).toContain('1 of which is yours');
    // The whole point of the sheet: recoverable, and said out loud.
    expect(copy.body).toContain('Nothing is deleted');
    expect(copy.confirmLabel).toBe('Turn off Markets');
  });

  it('does not claim the user wrote something when they did not', () => {
    const loss = botChatLoss(
      [BOT],
      transcript(message('a', false), message('b', false), message('c', false))
    )!;

    expect(botChatLossCopy('Markets', loss).body).not.toContain('yours');
  });
});
