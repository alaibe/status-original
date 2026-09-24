import type { LoginState } from '@/core/messaging/protocol';
import type { ChatMessage, Conversation } from '@/core/messaging/types';
import { TelegramSession } from './adapter';
import { messageIdOf } from './ids';
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
    expect(td().requests('setAuthenticationPhoneNumber')[0]).toMatchObject({
      phone_number: '+44123',
    });

    td().emit(
      authState('authorizationStateWaitCode', {
        code_info: { type: { '@type': 'authenticationCodeTypeTelegramMessage' } },
      })
    );
    await flush();
    expect(states.at(-1)).toMatchObject({
      step: 'code',
      hint: expect.stringContaining('other signed-in devices'),
    });

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
    td().emit(
      authState('authorizationStateWaitCode', {
        code_info: { type: { '@type': 'authenticationCodeTypeSms' } },
      })
    );
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

  it('loads group details, public links, and the chat photo', async () => {
    const { session, td } = await signedIn();
    const channel = channelChat(9, 'News');
    channel.photo = {
      small: {
        '@type': 'file',
        id: 7,
        size: 12,
        local: {
          path: '/tmp/news.jpg',
          is_downloading_completed: true,
          is_downloading_active: false,
        },
      },
      big: {
        '@type': 'file',
        id: 8,
        size: 12,
        local: { path: '', is_downloading_completed: false, is_downloading_active: false },
      },
    };
    td().emit({ '@type': 'updateNewChat', chat: channel });
    td().answer('getSupergroup', {
      '@type': 'supergroup',
      id: 9,
      usernames: { active_usernames: ['newsfeed'] },
      member_count: 27,
      status: { '@type': 'chatMemberStatusMember' },
      is_channel: true,
    });
    td().answer('getSupergroupFullInfo', {
      '@type': 'supergroupFullInfo',
      description: 'Daily updates',
      member_count: 27,
      invite_link: { invite_link: 'https://t.me/+private' },
    });

    expect(await session.getGroupInfo('-1000000000009')).toEqual({
      description: 'Daily updates',
      link: 'https://t.me/newsfeed',
      memberCount: 27,
      avatarUri: 'file:///tmp/news.jpg',
    });
    expect(td().requests('getSupergroupFullInfo')[0]).toMatchObject({ supergroup_id: 9 });
  });

  it('shows and changes slow mode for a supergroup administrator with restriction rights', async () => {
    const { session, td } = await signedIn();
    const group = channelChat(9, 'Team');
    group.type = { '@type': 'chatTypeSupergroup', supergroup_id: 9, is_channel: false };
    td().emit({ '@type': 'updateNewChat', chat: group });
    td().answer('getSupergroup', {
      '@type': 'supergroup',
      id: 9,
      member_count: 12,
      status: {
        '@type': 'chatMemberStatusAdministrator',
        rights: { can_restrict_members: true },
      },
      is_channel: false,
    });
    td().answer('getSupergroupFullInfo', {
      '@type': 'supergroupFullInfo',
      description: 'Team chat',
      member_count: 12,
      slow_mode_delay: 30,
    });

    expect(await session.getGroupInfo(String(group.id))).toMatchObject({
      slowModeDelay: 30,
      canSetSlowMode: true,
    });
    await session.setSlowModeDelay(String(group.id), 60);
    expect(td().requests('setChatSlowModeDelay')[0]).toMatchObject({
      chat_id: group.id,
      slow_mode_delay: 60,
    });
    await expect(session.setSlowModeDelay(String(group.id), 7)).rejects.toThrow();
  });

  it('says what an admin may do to messages, and what a member may not', async () => {
    const { session, td } = await signedIn();
    const group = channelChat(9, 'Team');
    group.type = { '@type': 'chatTypeSupergroup', supergroup_id: 9, is_channel: false };
    group.permissions = { can_send_basic_messages: true, can_pin_messages: false };
    td().emit({
      '@type': 'updateSupergroup',
      supergroup: {
        '@type': 'supergroup',
        id: 9,
        member_count: 3,
        status: {
          '@type': 'chatMemberStatusAdministrator',
          rights: { can_delete_messages: true, can_pin_messages: false },
        },
        is_channel: false,
      },
    });
    td().emit({ '@type': 'updateNewChat', chat: group });
    td().answer('getChats', { '@type': 'chats', chat_ids: [group.id] });
    const [admin] = await session.listConversations();
    expect(admin).toMatchObject({ canPin: false, canDeleteOthers: true });

    td().emit({ '@type': 'updateNewChat', chat: privateChat(200, 'Bob') });
    td().answer('getChats', { '@type': 'chats', chat_ids: [200] });
    const [dm] = await session.listConversations();
    expect(dm).toMatchObject({ canPin: true, canDeleteOthers: true });

    await session.deleteMessageForMe('200', messageIdOf(200, 7));
    expect(td().requests('deleteMessages')[0]).toMatchObject({
      chat_id: 200,
      message_ids: [7],
      revoke: false,
    });
  });

  it('previews and joins a public channel by its link', async () => {
    const { session, td } = await signedIn();
    const previewChat = channelChat(9, 'News');
    previewChat.positions = [];
    td().answer('searchPublicChat', previewChat);
    td().answer('getSupergroup', {
      '@type': 'supergroup',
      id: 9,
      member_count: 27,
      join_by_request: true,
      status: { '@type': 'chatMemberStatusLeft' },
      is_channel: true,
    });
    td().answer('getSupergroupFullInfo', {
      '@type': 'supergroupFullInfo',
      description: 'Daily updates',
      member_count: 27,
    });
    td().answer('getChat', channelChat(9, 'News'));

    expect(await session.previewPublicChat('https://t.me/newsfeed')).toMatchObject({
      id: '-1000000000009',
      title: 'News',
      kind: 'channel',
      joined: false,
      requiresApproval: true,
      description: 'Daily updates',
    });
    expect(td().requests('searchPublicChat')[0]).toMatchObject({ username: 'newsfeed' });
    td().answer('joinChat', tdError(400, 'INVITE_REQUEST_SENT'));
    expect(await session.joinPublicChat('-1000000000009')).toBeNull();
    td().answer('joinChat', { '@type': 'ok' });
    expect(await session.joinPublicChat('-1000000000009')).toMatchObject({
      id: '-1000000000009',
      kind: 'channel',
    });
    expect(td().requests('joinChat')[0]).toMatchObject({ chat_id: -1_000_000_000_009 });
  });

  it('previews invite links and treats approval requests as pending', async () => {
    const { session, td } = await signedIn();
    td().answer('checkChatInviteLink', {
      '@type': 'chatInviteLinkInfo',
      title: 'Members only',
      description: 'Private updates',
      member_count: 12,
      creates_join_request: true,
      type: { '@type': 'inviteLinkChatTypeChannel' },
    });
    expect(await session.previewPublicChat('t.me/+abc123')).toMatchObject({
      id: 'https://t.me/+abc123',
      joined: false,
      title: 'Members only',
      kind: 'channel',
      memberCount: 12,
      requiresApproval: true,
    });
    td().answer('joinChatByInviteLink', tdError(400, 'INVITE_REQUEST_SENT'));
    expect(await session.joinPublicChat('https://t.me/+abc123')).toBeNull();
    expect(td().requests('joinChatByInviteLink')[0]).toMatchObject({
      invite_link: 'https://t.me/+abc123',
    });

    td().answer('joinChatByInviteLink', channelChat(10, 'Members only'));
    expect(await session.joinPublicChat('https://t.me/+abc123')).toMatchObject({
      id: '-1000000000010',
      kind: 'channel',
    });
  });

  it('creates regular and approval invite links', async () => {
    const { session, td } = await signedIn();
    td().answer('createChatInviteLink', {
      '@type': 'chatInviteLink',
      invite_link: 'https://t.me/+newlink',
    });
    expect(await session.createInviteLink('-5', false)).toBe('https://t.me/+newlink');
    expect(await session.createInviteLink('-5', true)).toBe('https://t.me/+newlink');
    expect(td().requests('createChatInviteLink')).toEqual([
      expect.objectContaining({ chat_id: -5, creates_join_request: false, member_limit: 0 }),
      expect.objectContaining({ chat_id: -5, creates_join_request: true, member_limit: 0 }),
    ]);
  });

  it('lists and processes administrator join requests', async () => {
    const { session, td } = await signedIn();
    td().answer('getChatJoinRequests', {
      '@type': 'chatJoinRequests',
      total_count: 1,
      requests: [{ '@type': 'chatJoinRequest', user_id: 200, date: 1_700_000_000, bio: 'Hi' }],
    });
    expect(await session.getJoinRequests('-5')).toEqual([
      {
        userId: '200',
        name: 'Bob Builder',
        bio: 'Hi',
        requestedAt: 1_700_000_000_000,
      },
    ]);
    expect(td().requests('getChatJoinRequests')[0]).toMatchObject({ chat_id: -5, limit: 100 });

    await session.processJoinRequest('-5', '200', true);
    await session.processJoinRequest('-5', '200', false);
    expect(td().requests('processChatJoinRequest')).toEqual([
      expect.objectContaining({ chat_id: -5, user_id: 200, approve: true }),
      expect.objectContaining({ chat_id: -5, user_id: 200, approve: false }),
    ]);
  });

  it('bans and mutes members, and says who is muted', async () => {
    const { session, td } = await signedIn();
    td().answer('getBasicGroupFullInfo', {
      '@type': 'basicGroupFullInfo',
      members: [
        {
          member_id: { '@type': 'messageSenderUser', user_id: 300 },
          status: {
            '@type': 'chatMemberStatusRestricted',
            permissions: { can_send_basic_messages: false },
          },
        },
      ],
    });
    td().emit({ '@type': 'updateNewChat', chat: groupChat(5, 'Builders') });
    await flush();
    expect(await session.getMembers('-5')).toEqual([{ id: '300', role: 'member', muted: true }]);

    await session.setMemberMuted('-5', '300', false);
    await session.setMemberMuted('-5', '300', true);
    await session.banMember('-5', '300');
    expect(
      td()
        .requests('setChatMemberStatus')
        .map((r) => r.status)
    ).toEqual([
      { '@type': 'chatMemberStatusMember', member_until_date: 0 },
      expect.objectContaining({
        '@type': 'chatMemberStatusRestricted',
        permissions: expect.objectContaining({ can_send_basic_messages: false }),
      }),
    ]);
    expect(td().requests('banChatMember')[0]).toMatchObject({
      chat_id: -5,
      member_id: { '@type': 'messageSenderUser', user_id: 300 },
      banned_until_date: 0,
    });
  });

  it('lists private chats, groups, and channels in TDLib’s order', async () => {
    const { session, td } = await signedIn();
    td().answer('getBasicGroupFullInfo', {
      '@type': 'basicGroupFullInfo',
      members: [
        {
          member_id: { '@type': 'messageSenderUser', user_id: 100 },
          status: { '@type': 'chatMemberStatusCreator' },
        },
        {
          member_id: { '@type': 'messageSenderUser', user_id: 200 },
          status: { '@type': 'chatMemberStatusMember' },
        },
        {
          member_id: { '@type': 'messageSenderUser', user_id: 300 },
          status: { '@type': 'chatMemberStatusLeft' },
        },
      ],
    });
    td().emit({
      '@type': 'updateBasicGroup',
      basic_group_id: 5,
      basic_group: {
        '@type': 'basicGroup',
        id: 5,
        member_count: 2,
        status: { '@type': 'chatMemberStatusCreator' },
      },
    });
    const bob = privateChat(200, 'Bob Builder');
    bob.last_message = textMessage(200, 7, 200, 'hi');
    bob.unread_count = 4;
    td().emit({ '@type': 'updateNewChat', chat: bob });
    td().emit({ '@type': 'updateNewChat', chat: groupChat(5, 'Builders') });
    td().emit({ '@type': 'updateNewChat', chat: channelChat(9, 'News') });
    td().answer('getChats', { '@type': 'chats', chat_ids: [-5, -1_000_000_000_009, 200] });

    const conversations = await session.listConversations();
    expect(conversations.map((c) => [c.id, c.kind, c.title])).toEqual([
      ['-5', 'group', 'Builders'],
      ['-1000000000009', 'channel', 'News'],
      ['200', 'dm', 'Bob Builder'],
    ]);
    expect(conversations[0]).toMatchObject({
      memberIds: ['100', '200'],
      selfRole: 'owner',
      canSend: true,
      consent: 'allowed',
    });
    expect(conversations[1]).toMatchObject({ memberIds: ['100'], canSend: false });
    expect(conversations[2]).toMatchObject({
      memberIds: ['200', '100'],
      canSend: true,
      lastMessage: { id: '200_7', content: { kind: 'text', text: 'hi' } },
      unreadCount: 4,
    });
  });

  it('lets a channel admin post only with the right to post', async () => {
    const { session, td } = await signedIn();
    const admin = (rights: { can_post_messages?: boolean }) =>
      td().emit({
        '@type': 'updateSupergroup',
        supergroup: {
          '@type': 'supergroup',
          id: 9,
          member_count: 3,
          is_channel: true,
          status: { '@type': 'chatMemberStatusAdministrator', rights },
        },
      });
    admin({});
    td().emit({ '@type': 'updateNewChat', chat: channelChat(9, 'News') });
    td().answer('getChats', { '@type': 'chats', chat_ids: [-1_000_000_000_009] });
    expect((await session.listConversations())[0].canSend).toBe(false);

    admin({ can_post_messages: true });
    expect((await session.listConversations())[0].canSend).toBe(true);
  });

  it('updates group posting rights when permissions change', async () => {
    const { session, td } = await signedIn();
    td().emit({
      '@type': 'updateBasicGroup',
      basic_group_id: 5,
      basic_group: {
        '@type': 'basicGroup',
        id: 5,
        member_count: 2,
        status: { '@type': 'chatMemberStatusMember' },
      },
    });
    const chat = groupChat(5, 'Builders');
    chat.permissions = { can_send_basic_messages: false };
    td().emit({ '@type': 'updateNewChat', chat });
    td().answer('getChats', { '@type': 'chats', chat_ids: [-5] });
    expect((await session.listConversations())[0].canSend).toBe(false);

    const seen: Conversation[] = [];
    await session.streamConversations((conversation) => seen.push(conversation));
    td().emit({
      '@type': 'updateChatPermissions',
      chat_id: -5,
      permissions: { can_send_basic_messages: true },
    });
    await flush();
    expect(seen.at(-1)?.canSend).toBe(true);
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

    td().emit({
      '@type': 'updateChatReadInbox',
      chat_id: 200,
      last_read_inbox_message_id: 3,
      unread_count: 2,
    });
    await flush();
    expect(seen.at(-1)?.unreadCount).toBe(2);

    td().emit({
      '@type': 'updateChatUnreadMentionCount',
      chat_id: 200,
      unread_mention_count: 3,
    });
    await flush();
    expect(seen.at(-1)?.mentionCount).toBe(3);
  });

  it('shows typing and the peer’s online or last-seen status', async () => {
    const { session, td } = await signedIn();
    const seen: Conversation[] = [];
    await session.streamConversations((conversation) => seen.push(conversation));
    td().emit({ '@type': 'updateNewChat', chat: privateChat(200, 'Bob') });
    await flush();

    td().emit({
      '@type': 'updateUserStatus',
      user_id: 200,
      status: { '@type': 'userStatusOnline', expires: 1_700_000_000 },
    });
    await flush();
    expect(seen.at(-1)?.online).toBe(true);

    td().emit({
      '@type': 'updateChatAction',
      chat_id: 200,
      sender_id: { '@type': 'messageSenderUser', user_id: 200 },
      action: { '@type': 'chatActionTyping' },
    });
    await flush();
    expect(seen.at(-1)?.typing).toBe(true);

    td().emit({
      '@type': 'updateChatAction',
      chat_id: 200,
      sender_id: { '@type': 'messageSenderUser', user_id: 200 },
      action: { '@type': 'chatActionCancel' },
    });
    td().emit({
      '@type': 'updateUserStatus',
      user_id: 200,
      status: { '@type': 'userStatusOffline', was_online: 1_700_000_000 },
    });
    await flush();
    expect(seen.at(-1)).toMatchObject({
      typing: false,
      online: false,
      lastSeenAt: 1_700_000_000_000,
    });
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
      request.username === 'bob'
        ? privateChat(200, 'Bob')
        : request.username === 'news'
          ? channelChat(9, 'News')
          : tdError(400, 'USERNAME_NOT_OCCUPIED')
    );
    td().answer('searchUserByPhoneNumber', (request) =>
      request.phone_number === '+44123' ? BOB : tdError(404, 'Not Found')
    );
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
    expect(await session.resolveAddresses(['200', '300', '999'])).toEqual({
      '200': '@bob',
      '300': '300',
    });
    expect(await session.resolveNames(['200', '300'])).toEqual({
      '200': 'Bob Builder',
      '300': 'Carol',
    });
  });

  it('suggests group members with Telegram usernames for mentions', async () => {
    const { session, td } = await signedIn();
    td().answer('searchChatMembers', {
      '@type': 'chatMembers',
      members: [
        {
          member_id: { '@type': 'messageSenderUser', user_id: 100 },
          status: { '@type': 'chatMemberStatusMember' },
        },
        {
          member_id: { '@type': 'messageSenderUser', user_id: 200 },
          status: { '@type': 'chatMemberStatusMember' },
        },
      ],
    });
    expect(await session.mentionCandidates('-5', 'bo')).toEqual([
      { id: '200', name: 'Bob Builder', handle: '@bob' },
    ]);
    expect(td().requests('searchChatMembers')[0]).toMatchObject({
      chat_id: -5,
      query: 'bo',
      limit: 20,
    });
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

  it('searches one chat and all Telegram chats', async () => {
    const { session, td } = await inChatWithBob();
    td().answer('searchChatMessages', {
      '@type': 'foundChatMessages',
      messages: [textMessage(200, 2, 200, 'needle in this chat')],
      next_from_message_id: 0,
    });
    td().answer('searchMessages', {
      '@type': 'foundMessages',
      messages: [textMessage(200, 2, 200, 'needle in this chat')],
      next_offset: '',
    });

    expect((await session.searchMessages('needle', '200')).map((message) => message.id)).toEqual([
      '200_2',
    ]);
    expect((await session.searchMessages('needle')).map((message) => message.id)).toEqual([
      '200_2',
    ]);
    expect(td().requests('searchChatMessages')[0]).toMatchObject({ chat_id: 200, query: 'needle' });
    expect(td().requests('searchMessages')[0]).toMatchObject({ query: 'needle', chat_list: null });
  });

  it('lists pinned messages and pins or unpins with Telegram permissions', async () => {
    const { session, td, received } = await inChatWithBob();
    const raw = textMessage(200, 8, 200, 'Keep this');
    raw.is_pinned = true;
    td().answer('searchChatMessages', {
      '@type': 'foundChatMessages',
      messages: [raw],
      next_from_message_id: 0,
    });
    expect(await session.listPinnedMessages('200')).toEqual([
      expect.objectContaining({ id: '200_8', isPinned: true }),
    ]);
    expect(td().requests('searchChatMessages')[0]).toMatchObject({
      chat_id: 200,
      filter: { '@type': 'searchMessagesFilterPinned' },
    });

    td().answer('getMessageProperties', {
      '@type': 'messageProperties',
      can_be_pinned: true,
    });
    td().answer('getMessage', raw);
    await session.setMessagePinned('200', '200_8', true);
    expect(td().requests('pinChatMessage')[0]).toMatchObject({
      chat_id: 200,
      message_id: 8,
      disable_notification: true,
      only_for_self: false,
    });
    expect(received.at(-1)?.isPinned).toBe(true);
    await session.setMessagePinned('200', '200_8', false);
    expect(td().requests('unpinChatMessage')[0]).toMatchObject({ chat_id: 200, message_id: 8 });
  });

  it('shows poll options and sends a vote through TDLib', async () => {
    const { session, td, received } = await inChatWithBob();
    const raw = textMessage(200, 21, 200, '');
    raw.content = {
      '@type': 'messagePoll',
      poll: {
        '@type': 'poll',
        id: 44,
        question: { '@type': 'formattedText', text: 'Lunch?', entities: [] },
        options: ['Pizza', 'Soup'].map((text) => ({
          '@type': 'pollOption',
          text: { '@type': 'formattedText', text, entities: [] },
          voter_count: 0,
          vote_percentage: 0,
          is_chosen: false,
        })),
        total_voter_count: 0,
        type: { '@type': 'pollTypeRegular', allow_multiple_answers: false },
        is_closed: false,
      },
    };
    td().emit({ '@type': 'updateNewMessage', message: raw });
    await flush();
    expect(received.at(-1)?.content).toMatchObject({
      kind: 'poll',
      question: 'Lunch?',
      options: [
        { text: 'Pizza', chosen: false },
        { text: 'Soup', chosen: false },
      ],
    });

    const voted = structuredClone(raw);
    const poll = voted.content.poll as {
      options: { is_chosen: boolean }[];
      total_voter_count: number;
    };
    poll.options[1].is_chosen = true;
    poll.total_voter_count = 1;
    td().answer('getMessage', voted);
    await session.votePoll('200', '200_21', [1]);
    expect(td().requests('setPollAnswer')[0]).toMatchObject({
      chat_id: 200,
      message_id: 21,
      option_ids: [1],
    });
    expect(received.at(-1)?.content).toMatchObject({
      kind: 'poll',
      totalVoters: 1,
      options: [{ chosen: false }, { chosen: true }],
    });
  });

  it('creates an anonymous single-choice poll through TDLib', async () => {
    const { session, td } = await inChatWithBob();
    td().answer('sendMessage', textMessage(200, 25, 100, '', { outgoing: true }));
    await session.createPoll('200', 'Lunch?', ['Pizza', 'Soup']);
    expect(td().requests('sendMessage')[0]).toMatchObject({
      chat_id: 200,
      input_message_content: {
        '@type': 'inputMessagePoll',
        question: { text: 'Lunch?', entities: [] },
        options: [{ text: 'Pizza' }, { text: 'Soup' }],
        is_anonymous: true,
        type: { '@type': 'pollTypeRegular', allow_multiple_answers: false },
      },
    });
  });

  it('edits text and revokes deleted messages for everyone', async () => {
    const { session, td, received } = await inChatWithBob();
    const deleted: string[][] = [];
    await session.streamDeletedMessages((id, ids) => deleted.push([id, ...ids]));
    td().answer('getMessageProperties', {
      '@type': 'messageProperties',
      can_be_edited: true,
      can_be_deleted_for_all_users: true,
    });
    td().answer('editMessageText', textMessage(200, 5, 100, 'new text', { outgoing: true }));

    await session.editMessage('200', '200_5', 'new text');
    expect(td().requests('editMessageText')[0]).toMatchObject({
      chat_id: 200,
      message_id: 5,
      input_message_content: expect.objectContaining({ '@type': 'inputMessageText' }),
    });
    expect(received.at(-1)?.content).toEqual({ kind: 'text', text: 'new text' });

    await session.deleteMessage('200', '200_5');
    expect(td().requests('deleteMessages')[0]).toMatchObject({
      chat_id: 200,
      message_ids: [5],
      revoke: true,
    });
    td().emit({
      '@type': 'updateDeleteMessages',
      chat_id: 200,
      message_ids: [5],
      is_permanent: true,
      from_cache: false,
    });
    expect(deleted).toEqual([['200', '200_5']]);

    td().answer('getMessageProperties', {
      '@type': 'messageProperties',
      can_be_edited: false,
      can_be_deleted_for_all_users: false,
    });
    await expect(session.editMessage('200', '200_5', 'too late')).rejects.toThrow(
      'does not allow editing'
    );
    await expect(session.deleteMessage('200', '200_5')).rejects.toThrow('for everyone');
    expect(td().requests('deleteMessages')).toHaveLength(1);
  });

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

  it('streams channel posts', async () => {
    const { td, received } = await inChatWithBob();
    td().emit({ '@type': 'updateNewChat', chat: channelChat(9, 'News') });
    td().emit({
      '@type': 'updateNewMessage',
      message: textMessage(-1_000_000_000_009, 1, 200, 'broadcast'),
    });
    await flush();
    expect(received).toEqual([
      expect.objectContaining({
        conversationId: '-1000000000009',
        content: { kind: 'text', text: 'broadcast' },
      }),
    ]);
  });

  it('sends text as a reply and resolves once TDLib confirms the real id', async () => {
    const { session, td, received } = await inChatWithBob();
    td().answer(
      'sendMessage',
      textMessage(200, 5_000, 100, 'yo', { outgoing: true, pending: true })
    );

    const sending = session.send('200', { kind: 'text', text: 'yo' }, '200_12');
    await flush();
    expect(td().requests('sendMessage')[0]).toMatchObject({
      chat_id: 200,
      reply_to: { '@type': 'inputMessageReplyToMessage', message_id: 12 },
      input_message_content: { '@type': 'inputMessageText', text: { text: 'yo' } },
    });
    // The pending copy TDLib echoes is not the message.
    td().emit({
      '@type': 'updateNewMessage',
      message: textMessage(200, 5_000, 100, 'yo', { outgoing: true, pending: true }),
    });
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
    td().answer(
      'sendMessage',
      textMessage(200, 5_001, 100, 'x', { outgoing: true, pending: true })
    );
    const sending = session.send('200', { kind: 'text', text: 'x' });
    await flush();
    td().emit({
      '@type': 'updateMessageSendFailed',
      old_message_id: 5_001,
      error: { message: 'CHAT_WRITE_FORBIDDEN' },
    });
    await expect(sending).rejects.toThrow('CHAT_WRITE_FORBIDDEN');
  });

  it('sends photos, files, voice notes and video from local paths', async () => {
    const { session, td } = await inChatWithBob();
    td().answer('sendMessage', textMessage(200, 14, 100, '', { outgoing: true }));
    await session.send('200', {
      kind: 'image',
      uri: 'file:///tmp/a%20b.jpg',
      caption: 'cap',
      width: 1,
      height: 2,
    });
    await session.send('200', { kind: 'file', uri: 'file:///tmp/doc.pdf', name: 'doc.pdf' });
    await session.send('200', { kind: 'voice', uri: 'file:///tmp/v.m4a', durationMs: 2_400 });
    await session.send('200', {
      kind: 'video',
      uri: 'file:///tmp/movie.mp4',
      durationMs: 2_400,
      width: 640,
      height: 360,
    });
    const [photo, file, voice, video] = td()
      .requests('sendMessage')
      .map((r) => r.input_message_content);
    expect(photo).toMatchObject({
      '@type': 'inputMessagePhoto',
      photo: { path: '/tmp/a b.jpg' },
      caption: { text: 'cap' },
    });
    expect(file).toMatchObject({
      '@type': 'inputMessageDocument',
      document: { path: '/tmp/doc.pdf' },
    });
    expect(voice).toMatchObject({ '@type': 'inputMessageVoiceNote', duration: 2 });
    expect(video).toMatchObject({
      '@type': 'inputMessageVideo',
      video: { path: '/tmp/movie.mp4' },
      duration: 2,
      width: 640,
      height: 360,
      supports_streaming: true,
    });
  });

  it('adds and removes reactions on the target message', async () => {
    const { session, td } = await inChatWithBob();
    await session.send('200', {
      kind: 'reaction',
      targetId: '200_12',
      emoji: '❤️',
      action: 'added',
    });
    await session.send('200', {
      kind: 'reaction',
      targetId: '200_12',
      emoji: '❤️',
      action: 'removed',
    });
    expect(td().requests('addMessageReaction')[0]).toMatchObject({
      chat_id: 200,
      message_id: 12,
      reaction_type: { emoji: '❤️' },
    });
    expect(td().requests('removeMessageReaction')[0]).toMatchObject({
      chat_id: 200,
      message_id: 12,
    });
  });

  it('pages history oldest-first and stops at the boundary', async () => {
    const { session, td } = await inChatWithBob();
    const history = [30, 29, 28, 27, 26].map((id) => textMessage(200, id, 200, `m${id}`));
    td().answer('getChatHistory', (request) => {
      const from = request.from_message_id as number;
      const older = history.filter((m) => from === 0 || m.id < from);
      // TDLib's first server page is often a single message.
      return {
        '@type': 'messages',
        total_count: older.length,
        messages: older.slice(0, from === 0 ? 1 : 2),
      };
    });

    const page = await session.getMessages('200', { limit: 3 });
    expect(page.map((m) => m.id)).toEqual(['200_28', '200_29', '200_30']);

    const earlier = await session.getMessages('200', {
      limit: 10,
      before: { id: '200_28', sentAt: 0 },
    });
    expect(earlier.map((m) => m.id)).toEqual(['200_26', '200_27']);
  });

  it('shows a chat’s photo once TDLib has downloaded it', async () => {
    const { session, td } = await inChatWithBob();
    const conversations: Conversation[] = [];
    await session.streamConversations((conversation) => conversations.push(conversation));
    const small = {
      '@type': 'file',
      id: 88,
      size: 1,
      local: { path: '', is_downloading_completed: false, is_downloading_active: false },
    };
    td().answer('downloadFile', small);
    const chat = privateChat(300, 'Carol');
    chat.photo = { small, big: small } as never;
    td().emit({ '@type': 'updateNewChat', chat });
    await flush();
    expect(conversations.at(-1)?.avatarUri).toBeUndefined();
    expect(td().requests('downloadFile')[0]).toMatchObject({ file_id: 88, priority: 1 });

    const done = { ...small, local: { path: '/files/carol.jpg', is_downloading_completed: true } };
    chat.photo = { small: done, big: done } as never;
    td().emit({ '@type': 'updateFile', file: done });
    await flush();
    expect(conversations.at(-1)).toMatchObject({ id: '300' });
    expect(conversations.at(-1)?.avatarUri).toContain('/files/carol.jpg');
  });

  it('shows a placeholder for a photo until TDLib has it, then the image', async () => {
    const { td, received } = await inChatWithBob();
    td().answer('downloadFile', {
      '@type': 'file',
      id: 77,
      size: 1,
      local: { path: '', is_downloading_completed: false, is_downloading_active: true },
    });
    td().emit({
      '@type': 'updateNewMessage',
      message: photoMessage(200, 15, 200, { id: 77, path: '', downloaded: false }, 'sunset'),
    });
    await flush();
    expect(received[0].content).toEqual({
      kind: 'unsupported',
      typeId: 'photo',
      fallback: '📷 Photo · sunset',
    });
    expect(td().requests('downloadFile')[0]).toMatchObject({ file_id: 77 });

    td().answer(
      'getMessage',
      photoMessage(200, 15, 200, { id: 77, path: '/files/p.jpg', downloaded: true }, 'sunset')
    );
    td().emit({
      '@type': 'updateFile',
      file: {
        '@type': 'file',
        id: 77,
        size: 1,
        local: {
          path: '/files/p.jpg',
          is_downloading_completed: true,
          is_downloading_active: false,
        },
      },
    });
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

  it('renders a downloaded Telegram video with its caption', async () => {
    const { td, received } = await inChatWithBob();
    const message = textMessage(200, 16, 200, '');
    message.content = {
      '@type': 'messageVideo',
      video: {
        duration: 12,
        width: 640,
        height: 360,
        video: {
          '@type': 'file',
          id: 88,
          size: 1000,
          local: { path: '/files/movie.mp4', is_downloading_completed: true },
        },
      },
      caption: { '@type': 'formattedText', text: 'At the beach', entities: [] },
    };
    td().emit({ '@type': 'updateNewMessage', message });
    await flush();
    expect(received.at(-1)?.content).toEqual({
      kind: 'video',
      uri: 'file:///files/movie.mp4',
      durationMs: 12_000,
      width: 640,
      height: 360,
      caption: 'At the beach',
    });
  });

  it('says when a message was edited', async () => {
    const { td, received } = await inChatWithBob();
    const edited = textMessage(200, 7, 200, 'fixed');
    edited.edit_date = 1_700_000_000;
    td().emit({ '@type': 'updateNewMessage', message: edited });
    await flush();
    expect(received.at(-1)).toMatchObject({ edited: true });
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
    td().emit({
      '@type': 'updateChatLastMessage',
      chat_id: 200,
      last_message: chat.last_message,
      positions: chat.positions,
    });
    await flush();
    await session.sendReadReceipt('200');
    expect(td().requests('viewMessages')[0]).toMatchObject({
      chat_id: 200,
      message_ids: [40],
      force_read: true,
    });
  });

  it('counts requests to join as they arrive', async () => {
    const { session, td } = await inChatWithBob();
    const conversations: Conversation[] = [];
    await session.streamConversations((conversation) => conversations.push(conversation));
    td().emit({
      '@type': 'updateChatPendingJoinRequests',
      chat_id: 200,
      pending_join_requests: { total_count: 2, user_ids: [300] },
    });
    await flush();
    expect(conversations.at(-1)).toMatchObject({ id: '200', pendingJoinRequests: 2 });
  });

  it('keeps drafts on Telegram so they follow the chat', async () => {
    const { session, td } = await inChatWithBob();
    const conversations: Conversation[] = [];
    await session.streamConversations((conversation) => conversations.push(conversation));
    await session.saveDraft('200', 'see **you**');
    expect(td().requests('setChatDraftMessage')[0]).toMatchObject({
      chat_id: 200,
      draft_message: {
        '@type': 'draftMessage',
        content: { '@type': 'draftMessageContentText', text: { text: 'see you' } },
      },
    });
    await session.saveDraft('200', '');
    expect(td().requests('setChatDraftMessage')[1]).toMatchObject({ draft_message: null });

    td().emit({
      '@type': 'updateChatDraftMessage',
      chat_id: 200,
      draft_message: {
        content: {
          '@type': 'draftMessageContentText',
          text: { '@type': 'formattedText', text: 'from phone', entities: [] },
        },
      },
      positions: [MAIN_POSITION],
    });
    await flush();
    expect(conversations.at(-1)).toMatchObject({ id: '200', draft: 'from phone' });
  });

  it('marks a chat unread on Telegram and hears it from other devices', async () => {
    const { session, td } = await inChatWithBob();
    const conversations: Conversation[] = [];
    await session.streamConversations((conversation) => conversations.push(conversation));
    await session.setMarkedUnread('200', true);
    expect(td().requests('toggleChatIsMarkedAsUnread')[0]).toMatchObject({
      chat_id: 200,
      is_marked_as_unread: true,
    });
    td().emit({ '@type': 'updateChatIsMarkedAsUnread', chat_id: 200, is_marked_as_unread: true });
    await flush();
    expect(conversations.at(-1)).toMatchObject({ id: '200', markedUnread: true });
  });

  it('tells the chat when you start and stop typing', async () => {
    const { session, td } = await inChatWithBob();
    await session.setTyping('200', true);
    await session.setTyping('200', false);
    expect(
      td()
        .requests('sendChatAction')
        .map((r) => r.action)
    ).toEqual([{ '@type': 'chatActionTyping' }, { '@type': 'chatActionCancel' }]);
  });
});

describe('message ids', () => {
  it('survive negative chat ids', () => {
    expect(messageIdOf(-1_000_000_000_009, 42)).toBe('-1000000000009_42');
  });
});
