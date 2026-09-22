import type { LoginState } from '@/core/messaging/protocol';
import type { ChatMessage, Conversation } from '@/core/messaging/types';
import type { MxSession } from './api';
import { MatrixSession } from './adapter';
import { conversationIdOf, parseUserId, roomIdOf } from './ids';
import {
  BOB,
  CAROL,
  FakeMatrix,
  flush,
  imageEvent,
  ME,
  PARAMETERS,
  room,
  SESSION,
  textEvent,
} from './testing/fake-matrix';

/**
 * The Matrix adapter against a scripted SDK. What matters here is the
 * mapping and the sign-in state machine; matrix-rust-sdk is not under test.
 */

async function connect(session: MxSession | null = SESSION, prepare?: (api: FakeMatrix) => void) {
  const api = new FakeMatrix();
  prepare?.(api);
  const persisted: (MxSession | null)[] = [];
  const chat = await MatrixSession.connect({
    createApi: async () => api,
    parameters: { ...PARAMETERS, session },
    persistSession: async (next) => {
      persisted.push(next);
    },
  });
  await flush();
  return { chat, api, persisted };
}

function trackLogin(chat: MatrixSession) {
  const states: (LoginState | null)[] = [];
  chat.subscribeLogin((login) => states.push(login));
  return states;
}

const DM = room('!dm:example.org', { isDm: true, name: 'Bob Builder', heroes: [BOB] });
const GROUP = room('!group:example.org', { name: 'Builders', heroes: [BOB, CAROL], selfRole: 'admin' });
const DM_ID = conversationIdOf(DM.id);
const GROUP_ID = conversationIdOf(GROUP.id);

describe('MatrixSession sign-in', () => {
  it('starts the SDK with the caller’s directory, passphrase and saved session', async () => {
    const { api, chat } = await connect();
    expect(api.startParams).toMatchObject({ dataDirectory: '/tmp/matrix', storePassphrase: 'pass', session: SESSION });
    expect(chat.self).toEqual({ participantId: ME, address: ME });
  });

  it('asks for the password when nothing is saved, then keeps the session', async () => {
    const { chat, api, persisted } = await connect(null);
    const states = trackLogin(chat);
    expect(states.at(-1)).toMatchObject({ step: 'password', hint: expect.stringContaining('@me:example.org on example.org') });
    expect(chat.self).toEqual({ participantId: '', address: '' });

    await chat.submitLogin('hunter2');
    expect(api.named('login')).toEqual([['hunter2']]);
    expect(persisted).toEqual([SESSION]);
    expect(states.at(-1)).toBeNull();
    expect(chat.self.participantId).toBe(ME);
  });

  it('translates the homeserver’s errors and keeps the step', async () => {
    const { chat, api } = await connect(null);
    const states = trackLogin(chat);
    api.loginResult = new Error('M_FORBIDDEN: Invalid username/password');
    await expect(chat.submitLogin('nope')).rejects.toThrow('Wrong password.');
    expect(states.at(-1)).toMatchObject({ step: 'password', error: 'Wrong password.' });
  });

  it('signs out on the homeserver, then starts over without a session', async () => {
    const { chat, api, persisted } = await connect();
    const states = trackLogin(chat);
    await chat.signOut();
    expect(api.named('logout')).toHaveLength(1);
    expect(api.closed).toBe(true);
    expect(api.startParams?.session).toBeNull();
    expect(persisted.at(-1)).toBeNull();
    expect(states.at(-1)).toMatchObject({ step: 'password' });
    expect(chat.self.participantId).toBe('');
  });

  it('starts over when the homeserver ends the session, and says so', async () => {
    const { chat, api, persisted } = await connect();
    const states = trackLogin(chat);
    api.emit({ type: 'signedOut' });
    await flush();
    await flush();
    expect(api.startParams?.session).toBeNull();
    expect(persisted.at(-1)).toBeNull();
    expect(states.at(-1)).toMatchObject({ step: 'password', error: expect.stringContaining('ended this session') });
  });
});

describe('MatrixSession conversations', () => {
  it('lists joined rooms and invitations, not rooms that were left', async () => {
    const { chat, api } = await connect(SESSION, (api) => {
      api.roomsById.set(DM.id, DM);
      api.roomsById.set(GROUP.id, GROUP);
      api.roomsById.set('!old:example.org', room('!old:example.org', { membership: 'left' }));
      api.roomsById.set('!invite:example.org', room('!invite:example.org', { membership: 'invited', name: 'Later', inviter: BOB }));
    });
    const conversations = await chat.listConversations();
    expect(conversations.map((c) => roomIdOf(c.id)).sort()).toEqual([DM.id, GROUP.id, '!invite:example.org'].sort());

    const dm = conversations.find((c) => c.id === DM_ID)!;
    expect(dm).toMatchObject({ kind: 'dm', title: 'Bob Builder', memberIds: [BOB, ME], consent: 'allowed' });
    expect(dm.selfRole).toBeUndefined();

    const group = conversations.find((c) => c.id === GROUP_ID)!;
    expect(group).toMatchObject({ kind: 'group', title: 'Builders', selfRole: 'admin', consent: 'allowed' });
    expect(group.memberIds).toEqual([BOB, CAROL, ME]);

    expect(conversations.find((c) => c.id === conversationIdOf('!invite:example.org'))).toMatchObject({ consent: 'unknown', title: 'Later' });
    const invitedDm = conversationIdOf('!dm-invite:example.org');
    api.emit({ type: 'room', room: room('!dm-invite:example.org', { membership: 'invited', isDm: true, inviter: BOB, name: 'Bob' }) });
    expect((await chat.listConversations()).find((c) => c.id === invitedDm)).toMatchObject({ memberIds: [BOB, ME], title: 'Bob' });
  });

  it('announces room updates with their preview and streams events as messages', async () => {
    const { content: _, ...rest } = textEvent('$x', DM.id, BOB, 'hello');
    const latest = { sender: rest.sender, timestamp: rest.timestamp, isOwn: false, content: { kind: 'text' as const, body: 'hello' } };
    const { chat, api } = await connect();
    const conversations: Conversation[] = [];
    const messages: ChatMessage[] = [];
    await chat.streamConversations((c) => conversations.push(c));
    await chat.streamMessages((m) => messages.push(m));

    api.emit({ type: 'room', room: { ...DM, latest } });
    api.emit({ type: 'event', event: textEvent('$1', DM.id, BOB, 'hello') });
    api.emit({ type: 'room', room: room('!gone:example.org', { membership: 'left', latest }) });
    api.emit({ type: 'event', event: textEvent('$2', '!gone:example.org', BOB, 'bye') });
    await flush();

    expect(conversations).toHaveLength(1);
    expect(conversations[0].lastMessage).toMatchObject({ id: expect.stringMatching(/^preview:/), content: { kind: 'text', text: 'hello' } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: '$1', conversationId: DM_ID, senderId: BOB, fromMe: false });
  });

  it('names DM peers from the room and members from the roster', async () => {
    const { chat } = await connect(SESSION, (api) => {
      api.roomsById.set(DM.id, DM);
      api.roomMembers.set(GROUP.id, [
        { userId: ME, role: 'admin' },
        { userId: BOB, role: 'member', displayName: 'Bob' },
        { userId: CAROL, role: 'owner', displayName: 'Carol' },
      ]);
      api.profiles.set('@dan:example.org', { userId: '@dan:example.org', displayName: 'Dan' });
    });
    expect(await chat.resolveNames([BOB])).toEqual({ [BOB]: 'Bob Builder' });

    expect(await chat.getMembers(GROUP_ID)).toEqual([
      { id: ME, role: 'admin' },
      { id: BOB, role: 'member' },
      { id: CAROL, role: 'owner' },
    ]);
    expect(await chat.resolveNames([CAROL, '@dan:example.org', 'garbage'])).toEqual({
      [CAROL]: 'Carol',
      '@dan:example.org': 'Dan',
    });
    expect(await chat.resolveAddresses([BOB, 'garbage'])).toEqual({ [BOB]: BOB });
  });

  it('fills a group’s roster once the room is opened', async () => {
    const { chat, api } = await connect(SESSION, (api) => {
      api.roomsById.set(GROUP.id, GROUP);
      api.roomMembers.set(GROUP.id, [
        { userId: ME, role: 'member' },
        { userId: BOB, role: 'member' },
        { userId: CAROL, role: 'member' },
        { userId: '@dan:example.org', role: 'member' },
      ]);
    });
    const conversations: Conversation[] = [];
    await chat.streamConversations((c) => conversations.push(c));
    await chat.getMessages(GROUP_ID);
    await chat.getMessages(GROUP_ID);
    await flush();
    expect(api.named('members')).toEqual([[GROUP.id]]);
    expect(conversations.at(-1)?.memberIds).toEqual([ME, BOB, CAROL, '@dan:example.org']);
  });

  it('resolves Matrix IDs, matrix.to links and matrix: URIs against the profile API', async () => {
    const { chat, api } = await connect(SESSION, (api) => {
      api.profiles.set(BOB, { userId: BOB, displayName: 'Bob' });
    });
    expect(await chat.resolvePeer(' @bob:example.org ')).toBe(BOB);
    expect(await chat.resolvePeer('https://matrix.to/#/@bob:example.org')).toBe(BOB);
    expect(await chat.resolvePeer('matrix:u/bob:example.org')).toBe(BOB);
    expect(await chat.resolvePeer('bob:example.org')).toBe(BOB);
    expect(await chat.resolvePeer('@nobody:example.org')).toBeNull();
    expect(await chat.resolvePeer(ME)).toBeNull();
    expect(await chat.resolvePeer('bob')).toBeNull();
    expect(api.named('profile')).toHaveLength(5);
  });

  it('reuses an existing DM and otherwise creates one', async () => {
    const { chat, api } = await connect(SESSION, (api) => {
      api.roomsById.set(DM.id, DM);
    });
    expect((await chat.createDm(BOB)).id).toBe(DM_ID);
    expect(api.named('createDm')).toHaveLength(0);

    const created = await chat.createDm(CAROL);
    expect(created).toMatchObject({ id: conversationIdOf(`!dm-${CAROL}`), kind: 'dm', memberIds: [CAROL, ME] });

    const group = await chat.createGroup([BOB, CAROL], 'Crew');
    expect(group).toMatchObject({ id: conversationIdOf('!room-Crew'), kind: 'group', title: 'Crew' });
    expect(api.named('createRoom')).toEqual([[[BOB, CAROL], 'Crew']]);
  });

  it('accepts or declines invitations through consent, and blocks a DM peer', async () => {
    const invite = room('!invite:example.org', { membership: 'invited', isDm: true, heroes: [BOB] });
    const { chat, api } = await connect(SESSION, (api) => {
      api.roomsById.set(invite.id, invite);
      api.roomsById.set(DM.id, DM);
      api.roomsById.set(GROUP.id, GROUP);
    });

    const inviteId = conversationIdOf(invite.id);
    await chat.setConsent(inviteId, 'allowed');
    expect(api.named('join')).toEqual([[invite.id]]);
    await chat.setConsent(inviteId, 'denied');
    expect(api.named('leave')).toEqual([[invite.id]]);

    await chat.setConsent(DM_ID, 'denied');
    expect(api.named('ignore')).toEqual([[BOB, true]]);
    expect(api.named('leave')).toEqual([[invite.id], [DM.id]]);

    await chat.setConsent(GROUP_ID, 'denied');
    expect(api.named('leave')).toHaveLength(2);
  });

  it('forwards roster and room management calls', async () => {
    const { chat, api } = await connect();
    await chat.addMembers(GROUP_ID, [BOB, CAROL]);
    await chat.removeMembers(GROUP_ID, [CAROL]);
    await chat.renameGroup(GROUP_ID, 'New');
    await chat.leaveGroup(GROUP_ID);
    await chat.sendReadReceipt(GROUP_ID);
    expect(api.named('invite')).toEqual([[GROUP.id, BOB], [GROUP.id, CAROL]]);
    expect(api.named('kick')).toEqual([[GROUP.id, CAROL]]);
    expect(api.named('setName')).toEqual([[GROUP.id, 'New']]);
    expect(api.named('leave')).toEqual([[GROUP.id]]);
    expect(api.named('markRead')).toEqual([[GROUP.id]]);
  });
});

describe('MatrixSession messages', () => {
  it('pages history oldest first and maps replies, reactions and senders', async () => {
    const { chat } = await connect(SESSION, (api) => {
      api.roomsById.set(GROUP.id, GROUP);
      api.timelines.set(GROUP.id, [
        textEvent('$1', GROUP.id, BOB, 'first', { senderName: 'Bob' }),
        textEvent('$2', GROUP.id, ME, 'second', { replyTo: '$1', reactions: [{ key: '👍', senders: [BOB] }, { key: '❤️', senders: [] }] }),
        textEvent('$3', GROUP.id, CAROL, 'third', { status: 'failed' }),
      ]);
    });
    const page = await chat.getMessages(GROUP_ID, { limit: 2, before: { sentAt: 0, id: '$3' } });
    expect(page.map((m) => m.id)).toEqual(['$1', '$2']);
    expect(page[0]).toMatchObject({ senderId: BOB, fromMe: false, content: { kind: 'text', text: 'first' } });
    expect(page[1]).toMatchObject({ fromMe: true, replyTo: '$1', reactions: { '👍': [BOB] }, status: 'sent' });
    expect(page[1].reactions).not.toHaveProperty('❤️');

    const all = await chat.getMessages(GROUP_ID);
    expect(all[2]).toMatchObject({ id: '$3', status: 'failed' });
    expect(await chat.resolveNames([BOB])).toEqual({ [BOB]: 'Bob' });
  });

  it('renders membership and state changes as system lines', async () => {
    const { chat } = await connect(SESSION, (api) => {
      api.timelines.set(GROUP.id, [
        textEvent('$1', GROUP.id, BOB, '', { content: { kind: 'membership', change: 'invited', user: CAROL, userName: 'Carol' }, senderName: 'Bob' }),
        textEvent('$2', GROUP.id, CAROL, '', { content: { kind: 'membership', change: 'joined', user: CAROL } }),
        textEvent('$3', GROUP.id, BOB, '', { content: { kind: 'membership', change: 'kicked', user: CAROL } }),
        textEvent('$4', GROUP.id, BOB, '', { content: { kind: 'state', change: 'name', value: 'Crew' } }),
        textEvent('$7', GROUP.id, BOB, '', { content: { kind: 'text', body: 'waves', msgtype: 'emote' } }),
        textEvent('$8', GROUP.id, BOB, '', { content: { kind: 'undecryptable' } }),
        textEvent('$9', GROUP.id, BOB, '', { content: { kind: 'redacted' } }),
        textEvent('$10', GROUP.id, BOB, '', { content: { kind: 'poll', question: 'Lunch?' } }),
      ]);
    });
    const messages = await chat.getMessages(GROUP_ID);
    expect(messages.map((m) => m.content)).toEqual([
      { kind: 'system', text: 'Bob invited Carol' },
      { kind: 'system', text: 'Carol joined' },
      { kind: 'system', text: 'Bob removed Carol' },
      { kind: 'system', text: 'Renamed to "Crew"' },
      { kind: 'text', text: '* waves' },
      { kind: 'unsupported', typeId: 'undecryptable', fallback: '🔒 Waiting for the keys to this message' },
      { kind: 'unsupported', typeId: 'redacted', fallback: 'Message deleted' },
      { kind: 'unsupported', typeId: 'poll', fallback: '📊 Lunch?' },
    ]);
  });

  it('shows media as a placeholder until the download lands, then re-emits it', async () => {
    const { chat, api } = await connect(SESSION, (api) => {
      api.roomsById.set(DM.id, DM);
      api.timelines.set(DM.id, [imageEvent('$1', DM.id, BOB, 'cat.png')]);
    });
    const streamed: ChatMessage[] = [];
    await chat.streamMessages((m) => streamed.push(m));

    const [first] = await chat.getMessages(DM_ID);
    expect(first.content).toEqual({ kind: 'unsupported', typeId: 'image', fallback: '📷 Photo' });
    await flush();
    expect(api.named('media')).toHaveLength(1);
    expect(streamed).toHaveLength(1);
    expect(streamed[0].content).toMatchObject({ kind: 'image', uri: 'file:///matrix/media/cat.png', width: 10, height: 20 });

    const [again] = await chat.getMessages(DM_ID);
    expect(again.content).toMatchObject({ kind: 'image', uri: 'file:///matrix/media/cat.png' });
    expect(api.named('media')).toHaveLength(1);
  });

  it('sends text, replies, attachments and reactions', async () => {
    const { chat, api } = await connect();
    expect(await chat.send(DM_ID, { kind: 'text', text: 'hi' }, '$1')).toMatch(/^local:/);
    await chat.send(DM_ID, { kind: 'image', uri: 'file:///tmp/a%20b.png', width: 1, height: 2, mimeType: 'image/png' });
    await chat.send(DM_ID, { kind: 'voice', uri: 'file:///tmp/v.m4a', durationMs: 1500 });
    await chat.send(DM_ID, { kind: 'reaction', targetId: '$1', emoji: '👍', action: 'added' });
    expect(api.named('send')).toEqual([
      [DM.id, { kind: 'text', body: 'hi' }, '$1'],
      [DM.id, { kind: 'image', path: '/tmp/a b.png', width: 1, height: 2, mimeType: 'image/png' }, undefined],
      [DM.id, { kind: 'voice', path: '/tmp/v.m4a', durationMs: 1500 }, undefined],
    ]);
    expect(api.named('toggleReaction')).toEqual([[DM.id, '$1', '👍']]);
    await expect(chat.send(DM_ID, { kind: 'system', text: 'x' })).rejects.toThrow('cannot send');
  });

  it('closes without losing data, and erases on request', async () => {
    const { chat, api } = await connect();
    await chat.disconnect();
    expect(api.closed).toBe(true);
    expect(api.erased).toBe(false);

    const second = await connect();
    await second.chat.eraseLocalDatabase();
    expect(second.api.erased).toBe(true);
  });
});

describe('ids', () => {
  it('round-trips room ids through URL-safe conversation ids', () => {
    for (const id of ['!MompgmDILaFjHCeSqy:localhost', '!a:b', '!x_y-z:example.org:8448']) {
      expect(conversationIdOf(id)).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(roomIdOf(conversationIdOf(id))).toBe(id);
    }
  });
});

describe('parseUserId', () => {
  it('accepts the forms people paste and rejects the rest', () => {
    expect(parseUserId('@a:b.org')).toBe('@a:b.org');
    expect(parseUserId('https://matrix.to/#/%40a%3Ab.org?via=b.org')).toBe('@a:b.org');
    expect(parseUserId('matrix:u/a:b.org?action=chat')).toBe('@a:b.org');
    expect(parseUserId('a:b.org')).toBe('@a:b.org');
    expect(parseUserId('!room:b.org')).toBeNull();
    expect(parseUserId('@a')).toBeNull();
    expect(parseUserId('')).toBeNull();
  });
});
