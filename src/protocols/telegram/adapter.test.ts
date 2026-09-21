import type { LoginState } from '@/core/messaging/protocol';
import type { ChatMessage, Conversation } from '@/core/messaging/types';
import { TelegramSession, messageIdOf } from './adapter';
import {
  authState,
  channelChat,
  FakeTdlib,
  flush,
  groupChat,
  MAIN_POSITION,
  photoMessage,
  privateChat,
  tdError,
  textMessage,
  user,
} from './testing/fake-tdlib';

/**
 * The Telegram adapter against a scripted TDLib. What matters here is the
 * mapping and the sign-in state machine; TDLib itself is not under test.
 */

const ME = user(100, 'Me', '', 'me_user');
const BOB = user(200, 'Bob', 'Builder', 'bob');
const CAROL = user(300, 'Carol');

const PARAMETERS = {
  databaseDirectory: '/tmp/tdlib',
  apiId: 1,
  apiHash: 'hash',
  databaseEncryptionKey: 'a2V5',
  deviceModel: 'test',
  systemVersion: '1',
  applicationVersion: '1',
};

async function connect() {
  const apis: FakeTdlib[] = [];
  const session = await TelegramSession.connect({
    createApi: async () => {
      const api = new FakeTdlib();
      api.answer('getMe', ME);
      api.answer('loadChats', tdError(404, 'Not Found'));
      api.answer('getChats', { '@type': 'chats', chat_ids: [] });
      apis.push(api);
      return api;
    },
    parameters: PARAMETERS,
  });
  return { session, apis, td: () => apis[apis.length - 1] };
}

async function signIn(td: FakeTdlib) {
  td.emit(authState('authorizationStateReady'));
  await flush();
}

function trackLogin(session: TelegramSession) {
  const states: (LoginState | null)[] = [];
  session.subscribeLogin((login) => states.push(login));
  return states;
}

describe('TelegramSession sign-in', () => {
  it('sends TDLib parameters with the caller’s directory and key', async () => {
    const { td } = await connect();
    const [params] = td().requests('setTdlibParameters');
    expect(params).toMatchObject({
      database_directory: '/tmp/tdlib',
      api_id: 1,
      api_hash: 'hash',
      database_encryption_key: 'a2V5',
      use_secret_chats: false,
    });
  });

  it('walks phone, code and password, then knows who it is', async () => {
    const { session, td } = await connect();
    const states = trackLogin(session);

    td().emit(authState('authorizationStateWaitPhoneNumber'));
    await flush();
    expect(states.at(-1)).toMatchObject({ step: 'phone' });
    expect(session.self).toEqual({ participantId: '', address: '' });

    await session.submitLogin(' +44123 ');
    expect(td().requests('setAuthenticationPhoneNumber')[0]).toMatchObject({ phone_number: '+44123' });

    td().emit(
      authState('authorizationStateWaitCode', {
        code_info: { type: { '@type': 'authenticationCodeTypeTelegramMessage' } },
      }),
    );
    await flush();
    expect(states.at(-1)).toMatchObject({ step: 'code', hint: expect.stringContaining('other signed-in devices') });

    await session.submitLogin('12345');
    expect(td().requests('checkAuthenticationCode')[0]).toMatchObject({ code: '12345' });

    td().emit(authState('authorizationStateWaitPassword', { password_hint: 'pet' }));
    await flush();
    expect(states.at(-1)).toMatchObject({ step: 'password', hint: expect.stringContaining('pet') });

    await session.submitLogin('hunter2');
    expect(td().requests('checkAuthenticationPassword')[0]).toMatchObject({ password: 'hunter2' });

    await signIn(td());
    expect(states.at(-1)).toBeNull();
    expect(session.self).toEqual({ participantId: '100', address: '@me_user' });
    expect(td().requests('setOption')[0]).toMatchObject({ name: 'online' });
  });

  it('translates TDLib’s auth errors and keeps the step', async () => {
    const { session, td } = await connect();
    const states = trackLogin(session);
    td().emit(authState('authorizationStateWaitCode', { code_info: { type: { '@type': 'authenticationCodeTypeSms' } } }));
    await flush();

    td().answer('checkAuthenticationCode', tdError(400, 'PHONE_CODE_INVALID'));
    await expect(session.submitLogin('0000')).rejects.toThrow('That code is not right.');
    expect(states.at(-1)).toMatchObject({ step: 'code', error: 'That code is not right.' });

    td().answer('checkAuthenticationCode', tdError(429, 'Too Many Requests: retry after 30'));
    await expect(session.submitLogin('0000')).rejects.toThrow('Wait 30 seconds');
  });

  it('starts over when the number has no account, and says why', async () => {
    const { session, apis, td } = await connect();
    const states = trackLogin(session);

    td().emit(authState('authorizationStateWaitRegistration'));
    await flush();
    expect(td().requests('destroy')).toHaveLength(1);

    td().emit(authState('authorizationStateClosed'));
    await flush();
    expect(apis).toHaveLength(2);
    expect(apis[0].closed).toBe(true);

    td().emit(authState('authorizationStateWaitPhoneNumber'));
    await flush();
    expect(states.at(-1)).toMatchObject({
      step: 'phone',
      error: expect.stringContaining('no Telegram account'),
    });
  });

  it('signs out through TDLib and comes back ready for a new sign-in', async () => {
    const { session, apis, td } = await connect();
    await signIn(td());
    expect(session.self.participantId).toBe('100');

    await session.signOut();
    expect(td().requests('logOut')).toHaveLength(1);

    td().emit(authState('authorizationStateClosed'));
    await flush();
    expect(apis).toHaveLength(2);
    expect(session.self.participantId).toBe('');

    td().emit(authState('authorizationStateWaitPhoneNumber'));
    await flush();
  });

  it('does not restart after disconnect or erase', async () => {
    const { session, apis, td } = await connect();
    await session.disconnect();
    expect(td().closed).toBe(true);
    td().emit(authState('authorizationStateClosed'));
    await flush();
    expect(apis).toHaveLength(1);

    const second = await connect();
    await second.session.eraseLocalDatabase();
    expect(second.td().destroyed).toBe(true);
  });
});

describe('TelegramSession conversations', () => {
  async function signedIn() {
    const context = await connect();
    await signIn(context.td());
    context.td().emit({ '@type': 'updateUser', user: BOB });
    context.td().emit({ '@type': 'updateUser', user: CAROL });
    return context;
  }

  it('lists private chats and groups in TDLib’s order, never channels', async () => {
    const { session, td } = await signedIn();
    td().answer('getBasicGroupFullInfo', {
      '@type': 'basicGroupFullInfo',
      members: [
        { member_id: { '@type': 'messageSenderUser', user_id: 100 }, status: { '@type': 'chatMemberStatusCreator' } },
        { member_id: { '@type': 'messageSenderUser', user_id: 200 }, status: { '@type': 'chatMemberStatusMember' } },
        { member_id: { '@type': 'messageSenderUser', user_id: 300 }, status: { '@type': 'chatMemberStatusLeft' } },
      ],
    });
    td().emit({ '@type': 'updateBasicGroup', basic_group_id: 5, basic_group: {
      '@type': 'basicGroup', id: 5, member_count: 2, status: { '@type': 'chatMemberStatusCreator' },
    } });
    const bob = privateChat(200, 'Bob Builder');
    bob.last_message = textMessage(200, 7, 200, 'hi');
    td().emit({ '@type': 'updateNewChat', chat: bob });
    td().emit({ '@type': 'updateNewChat', chat: groupChat(5, 'Builders') });
    td().emit({ '@type': 'updateNewChat', chat: channelChat(9, 'News') });
    td().answer('getChats', { '@type': 'chats', chat_ids: [-5, -1_000_000_000_009, 200] });

    const conversations = await session.listConversations();
    expect(conversations.map((c) => [c.id, c.kind, c.title])).toEqual([
      ['-5', 'group', 'Builders'],
      ['200', 'dm', 'Bob Builder'],
    ]);
    expect(conversations[0]).toMatchObject({ memberIds: ['100', '200'], selfRole: 'owner', consent: 'allowed' });
    expect(conversations[1]).toMatchObject({
      memberIds: ['200', '100'],
      lastMessage: { id: '200_7', content: { kind: 'text', text: 'hi' } },
    });
  });

  it('streams a chat when it lands in the main list, and again when its title changes', async () => {
    const { session, td } = await signedIn();
    const seen: Conversation[] = [];
    await session.streamConversations((c) => seen.push(c));

    td().emit({ '@type': 'updateNewChat', chat: privateChat(200, 'Bob', []) });
    await flush();
    expect(seen).toHaveLength(0);

    td().emit({ '@type': 'updateChatPosition', chat_id: 200, position: MAIN_POSITION });
    await flush();
    expect(seen.map((c) => c.title)).toEqual(['Bob']);

    td().emit({ '@type': 'updateChatTitle', chat_id: 200, title: 'Robert' });
    await flush();
    expect(seen.map((c) => c.title)).toEqual(['Bob', 'Robert']);
  });

  it('replays chats that arrived before anyone listened', async () => {
    const { session, td } = await signedIn();
    td().emit({ '@type': 'updateNewChat', chat: privateChat(200, 'Bob') });
    const seen: Conversation[] = [];
    await session.streamConversations((c) => seen.push(c));
    await flush();
    expect(seen.map((c) => c.id)).toEqual(['200']);
  });

  it('resolves usernames, links and phone numbers to people only', async () => {
    const { session, td } = await signedIn();
    td().answer('searchPublicChat', (request) =>
      request.username === 'bob' ? privateChat(200, 'Bob') : request.username === 'news' ? channelChat(9, 'News') : tdError(400, 'USERNAME_NOT_OCCUPIED'),
    );
    td().answer('searchUserByPhoneNumber', (request) => (request.phone_number === '+44123' ? BOB : tdError(404, 'Not Found')));
    td().answer('getUser', tdError(400, 'USER_ID_INVALID'));

    expect(await session.resolvePeer('@bob')).toBe('200');
    expect(await session.resolvePeer('https://t.me/bob')).toBe('200');
    expect(await session.resolvePeer('@news')).toBeNull();
    expect(await session.resolvePeer('nobody_here')).toBeNull();
    expect(await session.resolvePeer('+44123')).toBe('200');
    expect(await session.resolvePeer('+1555')).toBeNull();
    expect(await session.resolvePeer('not a handle!')).toBeNull();
  });

  it('gives handles as addresses and full names as names', async () => {
    const { session } = await signedIn();
    expect(await session.resolveAddresses(['200', '300', '999'])).toEqual({ '200': '@bob', '300': '300' });
    expect(await session.resolveNames(['200', '300'])).toEqual({ '200': 'Bob Builder', '300': 'Carol' });
  });
});

describe('TelegramSession messages', () => {
  async function inChatWithBob() {
    const context = await connect();
    await signIn(context.td());
    context.td().emit({ '@type': 'updateUser', user: BOB });
    context.td().emit({ '@type': 'updateNewChat', chat: privateChat(200, 'Bob') });
    const received: ChatMessage[] = [];
    await context.session.streamMessages((m) => received.push(m));
    return { ...context, received };
  }

  it('delivers incoming messages with chat-scoped ids, replies and reactions', async () => {
    const { td, received } = await inChatWithBob();
    const raw = textMessage(200, 12, 200, 'hello', { replyTo: 11 });
    raw.interaction_info = {
      reactions: {
        reactions: [
          {
            type: { '@type': 'reactionTypeEmoji', emoji: '👍' },
            total_count: 2,
            is_chosen: true,
            recent_sender_ids: [{ '@type': 'messageSenderUser', user_id: 200 }],
          },
        ],
      },
    };
    td().emit({ '@type': 'updateNewMessage', message: raw });
    await flush();

    expect(received).toEqual([
      expect.objectContaining({
        id: '200_12',
        conversationId: '200',
        senderId: '200',
        fromMe: false,
        status: 'sent',
        replyTo: '200_11',
        reactions: { '👍': ['200', '100'] },
        content: { kind: 'text', text: 'hello' },
      }),
    ]);
  });

  it('ignores channel traffic', async () => {
    const { td, received } = await inChatWithBob();
    td().emit({ '@type': 'updateNewChat', chat: channelChat(9, 'News') });
    td().emit({ '@type': 'updateNewMessage', message: textMessage(-1_000_000_000_009, 1, 200, 'broadcast') });
    await flush();
    expect(received).toHaveLength(0);
  });

  it('sends text as a reply and resolves once TDLib confirms the real id', async () => {
    const { session, td, received } = await inChatWithBob();
    td().answer('sendMessage', textMessage(200, 5_000, 100, 'yo', { outgoing: true, pending: true }));

    const sending = session.send('200', { kind: 'text', text: 'yo' }, '200_12');
    await flush();
    expect(td().requests('sendMessage')[0]).toMatchObject({
      chat_id: 200,
      reply_to: { '@type': 'inputMessageReplyToMessage', message_id: 12 },
      input_message_content: { '@type': 'inputMessageText', text: { text: 'yo' } },
    });
    // The pending copy TDLib echoes is not the message.
    td().emit({ '@type': 'updateNewMessage', message: textMessage(200, 5_000, 100, 'yo', { outgoing: true, pending: true }) });
    td().emit({
      '@type': 'updateMessageSendSucceeded',
      old_message_id: 5_000,
      message: textMessage(200, 13, 100, 'yo', { outgoing: true }),
    });

    expect(await sending).toBe('200_13');
    await flush();
    expect(received.map((m) => [m.id, m.fromMe, m.status])).toEqual([['200_13', true, 'sent']]);
  });

  it('turns a rejected send into a failure', async () => {
    const { session, td } = await inChatWithBob();
    td().answer('sendMessage', textMessage(200, 5_001, 100, 'x', { outgoing: true, pending: true }));
    const sending = session.send('200', { kind: 'text', text: 'x' });
    await flush();
    td().emit({ '@type': 'updateMessageSendFailed', old_message_id: 5_001, error: { message: 'CHAT_WRITE_FORBIDDEN' } });
    await expect(sending).rejects.toThrow('CHAT_WRITE_FORBIDDEN');
  });

  it('sends photos, files and voice notes from local paths', async () => {
    const { session, td } = await inChatWithBob();
    td().answer('sendMessage', textMessage(200, 14, 100, '', { outgoing: true }));
    await session.send('200', { kind: 'image', uri: 'file:///tmp/a%20b.jpg', caption: 'cap', width: 1, height: 2 });
    await session.send('200', { kind: 'file', uri: 'file:///tmp/doc.pdf', name: 'doc.pdf' });
    await session.send('200', { kind: 'voice', uri: 'file:///tmp/v.m4a', durationMs: 2_400 });
    const [photo, file, voice] = td().requests('sendMessage').map((r) => r.input_message_content);
    expect(photo).toMatchObject({ '@type': 'inputMessagePhoto', photo: { path: '/tmp/a b.jpg' }, caption: { text: 'cap' } });
    expect(file).toMatchObject({ '@type': 'inputMessageDocument', document: { path: '/tmp/doc.pdf' } });
    expect(voice).toMatchObject({ '@type': 'inputMessageVoiceNote', duration: 2 });
  });

  it('adds and removes reactions on the target message', async () => {
    const { session, td } = await inChatWithBob();
    await session.send('200', { kind: 'reaction', targetId: '200_12', emoji: '❤️', action: 'added' });
    await session.send('200', { kind: 'reaction', targetId: '200_12', emoji: '❤️', action: 'removed' });
    expect(td().requests('addMessageReaction')[0]).toMatchObject({ chat_id: 200, message_id: 12, reaction_type: { emoji: '❤️' } });
    expect(td().requests('removeMessageReaction')[0]).toMatchObject({ chat_id: 200, message_id: 12 });
  });

  it('pages history oldest-first and stops at the boundary', async () => {
    const { session, td } = await inChatWithBob();
    const history = [30, 29, 28, 27, 26].map((id) => textMessage(200, id, 200, `m${id}`));
    td().answer('getChatHistory', (request) => {
      const from = request.from_message_id as number;
      const older = history.filter((m) => from === 0 || m.id < from);
      // TDLib's first server page is often a single message.
      return { '@type': 'messages', total_count: older.length, messages: older.slice(0, from === 0 ? 1 : 2) };
    });

    const page = await session.getMessages('200', { limit: 3 });
    expect(page.map((m) => m.id)).toEqual(['200_28', '200_29', '200_30']);

    const earlier = await session.getMessages('200', { limit: 10, before: { id: '200_28', sentAt: 0 } });
    expect(earlier.map((m) => m.id)).toEqual(['200_26', '200_27']);
  });

  it('shows a placeholder for a photo until TDLib has it, then the image', async () => {
    const { td, received } = await inChatWithBob();
    td().answer('downloadFile', { '@type': 'file', id: 77, size: 1, local: { path: '', is_downloading_completed: false, is_downloading_active: true } });
    td().emit({ '@type': 'updateNewMessage', message: photoMessage(200, 15, 200, { id: 77, path: '', downloaded: false }, 'sunset') });
    await flush();
    expect(received[0].content).toEqual({ kind: 'unsupported', typeId: 'photo', fallback: '📷 Photo · sunset' });
    expect(td().requests('downloadFile')[0]).toMatchObject({ file_id: 77 });

    td().answer('getMessage', photoMessage(200, 15, 200, { id: 77, path: '/files/p.jpg', downloaded: true }, 'sunset'));
    td().emit({ '@type': 'updateFile', file: { '@type': 'file', id: 77, size: 1, local: { path: '/files/p.jpg', is_downloading_completed: true, is_downloading_active: false } } });
    await flush();
    expect(received[1].content).toEqual({
      kind: 'image',
      uri: 'file:///files/p.jpg',
      width: 800,
      height: 600,
      size: 1234,
      caption: 'sunset',
    });
  });

  it('describes service messages with names', async () => {
    const { td, received } = await inChatWithBob();
    td().emit({ '@type': 'updateNewChat', chat: groupChat(5, 'Builders') });
    const joined = textMessage(-5, 3, 200, '');
    joined.content = { '@type': 'messageChatAddMembers', member_user_ids: [200] };
    td().emit({ '@type': 'updateNewMessage', message: joined });
    await flush();
    expect(received[0].content).toEqual({ kind: 'system', text: 'Bob Builder joined' });
  });

  it('marks the latest message read on request', async () => {
    const { session, td } = await inChatWithBob();
    const chat = privateChat(200, 'Bob');
    chat.last_message = textMessage(200, 40, 200, 'last');
    td().emit({ '@type': 'updateChatLastMessage', chat_id: 200, last_message: chat.last_message, positions: chat.positions });
    await flush();
    await session.sendReadReceipt('200');
    expect(td().requests('viewMessages')[0]).toMatchObject({ chat_id: 200, message_ids: [40], force_read: true });
  });
});

describe('message ids', () => {
  it('survive negative chat ids', () => {
    expect(messageIdOf(-1_000_000_000_009, 42)).toBe('-1000000000009_42');
  });
});
