import { availableFolders, countInFolder, matchesFolder } from './folders';
import type { Conversation } from './types';

function conversation(over: Partial<Conversation> & { id: string }): Conversation {
  return {
    kind: 'dm',
    title: over.id,
    memberIds: [],
    createdAt: 0,
    consent: 'allowed',
    lastMessage: {
      id: `${over.id}-m`,
      conversationId: over.id,
      senderId: 'other',
      sentAt: 1_000,
      content: { kind: 'text', text: 'hi' },
      fromMe: false,
      status: 'sent',
    },
    ...over,
  };
}

const empty = { prefs: {}, readAt: {} };

describe('matchesFolder', () => {
  it('puts everything in All', () => {
    expect(matchesFolder(conversation({ id: 'c1' }), 'all', empty)).toBe(true);
  });

  it('matches groups and bots by their own shape', () => {
    expect(matchesFolder(conversation({ id: 'c1', kind: 'group' }), 'groups', empty)).toBe(true);
    expect(matchesFolder(conversation({ id: 'local-status' }), 'bots', empty)).toBe(true);
    expect(matchesFolder(conversation({ id: 'c1' }), 'bots', empty)).toBe(false);
  });

  it('puts one-to-one chats in Direct, but not the app’s own bot rooms', () => {
    expect(matchesFolder(conversation({ id: 'dm' }), 'direct', empty)).toBe(true);
    expect(matchesFolder(conversation({ id: 'g', kind: 'group' }), 'direct', empty)).toBe(false);
    expect(matchesFolder(conversation({ id: 'local-status' }), 'direct', empty)).toBe(false);
  });

  it('matches a transport', () => {
    const c = conversation({ id: 'c1', protocol: 'nostr' });
    expect(matchesFolder(c, 'protocol:nostr', empty)).toBe(true);
    expect(matchesFolder(c, 'protocol:xmtp', empty)).toBe(false);
  });

  it('counts an unread conversation as unread', () => {
    expect(matchesFolder(conversation({ id: 'c1' }), 'unread', empty)).toBe(true);
  });

  it('excludes muted conversations from Unread', () => {
    // Muting says "stop drawing my attention"; an Unread folder is nothing but
    // attention, so honouring one means honouring the other.
    const c = conversation({ id: 'c1' });
    expect(matchesFolder(c, 'unread', { prefs: { c1: { muted: true } }, readAt: {} })).toBe(false);
  });

  it('excludes a conversation already read', () => {
    const c = conversation({ id: 'c1' });
    expect(matchesFolder(c, 'unread', { prefs: {}, readAt: { c1: 5_000 } })).toBe(false);
  });
});

describe('availableFolders', () => {
  it('always offers All, even with nothing to show', () => {
    expect(availableFolders([], empty).map((f) => f.id)).toEqual(['all']);
  });

  it('omits folders that would be empty', () => {
    // A tab that leads nowhere is noise, and the set grows with every
    // transport ever added.
    const ids = availableFolders([conversation({ id: 'c1' })], {
      prefs: {},
      readAt: { c1: 5_000 },
    }).map((f) => f.id);
    expect(ids).not.toContain('groups');
    expect(ids).not.toContain('bots');
    expect(ids).not.toContain('unread');
  });

  it('offers Groups and Bots when they exist', () => {
    const ids = availableFolders(
      [conversation({ id: 'g', kind: 'group' }), conversation({ id: 'local-status' })],
      { prefs: {}, readAt: { g: 5_000, 'local-status': 5_000 } }
    ).map((f) => f.id);

    expect(ids).toContain('groups');
    expect(ids).toContain('bots');
    expect(ids).not.toContain('direct');
  });

  it('offers Direct next to Groups when there are one-to-one chats', () => {
    const ids = availableFolders(
      [conversation({ id: 'dm' }), conversation({ id: 'g', kind: 'group' })],
      { prefs: {}, readAt: { dm: 5_000, g: 5_000 } }
    ).map((f) => f.id);
    expect(ids).toEqual(['all', 'direct', 'groups']);
  });

  it('offers transport folders only when more than one is in use', () => {
    const single = availableFolders([conversation({ id: 'a', protocol: 'xmtp' })], empty);
    expect(single.some((f) => f.id.startsWith('protocol:'))).toBe(false);

    const many = availableFolders(
      [conversation({ id: 'a', protocol: 'xmtp' }), conversation({ id: 'b', protocol: 'nostr' })],
      empty
    );
    expect(many.map((f) => f.id)).toContain('protocol:xmtp');
    expect(many.map((f) => f.id)).toContain('protocol:nostr');
  });

  it('ignores the local pseudo-protocol when deciding', () => {
    const folders = availableFolders(
      [
        conversation({ id: 'a', protocol: 'xmtp' }),
        conversation({ id: 'local-x', protocol: 'local' }),
      ],
      empty
    );
    expect(folders.some((f) => f.id.startsWith('protocol:'))).toBe(false);
  });
});

describe('countInFolder', () => {
  it('counts matches', () => {
    const list = [conversation({ id: 'a', kind: 'group' }), conversation({ id: 'b' })];
    expect(countInFolder(list, 'groups', empty)).toBe(1);
    expect(countInFolder(list, 'all', empty)).toBe(2);
  });
});
