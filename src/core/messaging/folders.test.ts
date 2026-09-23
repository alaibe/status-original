import { inboxRows, inDirectory, isUnreadHere, matchesFilter, type InboxRow } from './folders';
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
const shape = (rows: InboxRow[]) =>
  rows.map((r) =>
    r.kind === 'chat' ? r.conversation.id : `${r.directory}[${r.chats.map((c) => c.id)}]`
  );

describe('matchesFilter', () => {
  it('sorts chats into Direct and Groups, keeping the app’s own bots out of Direct', () => {
    expect(matchesFilter(conversation({ id: 'dm' }), 'direct', empty)).toBe(true);
    expect(matchesFilter(conversation({ id: 'g', kind: 'group' }), 'groups', empty)).toBe(true);
    expect(matchesFilter(conversation({ id: 'c', kind: 'channel' }), 'groups', empty)).toBe(true);
    expect(matchesFilter(conversation({ id: 'local-status' }), 'direct', empty)).toBe(false);
  });

  it('counts unread, but not muted or already read', () => {
    const c = conversation({ id: 'c1' });
    expect(isUnreadHere(c, empty)).toBe(true);
    expect(isUnreadHere(c, { prefs: { c1: { muted: true } }, readAt: {} })).toBe(false);
    expect(isUnreadHere(c, { prefs: {}, readAt: { c1: 5_000 } })).toBe(false);
  });

  it('shows chats with unread mentions in the Mentions filter', () => {
    expect(
      matchesFilter(conversation({ id: 'g', kind: 'group', mentionCount: 2 }), 'mentions', empty)
    ).toBe(true);
    expect(
      matchesFilter(conversation({ id: 'h', kind: 'group', mentionCount: 0 }), 'mentions', empty)
    ).toBe(false);
  });

  it('drops a chat from Mentions once it is read here, whatever the network still counts', () => {
    const read = { prefs: {}, readAt: { g: 5_000 } };
    expect(
      matchesFilter(conversation({ id: 'g', kind: 'group', mentionCount: 2 }), 'mentions', read)
    ).toBe(false);
  });
});

describe('inDirectory', () => {
  it('holds a network’s chats, bridged or native, and the archive holds only archived ones', () => {
    const slack = conversation({ id: 's', protocol: 'matrix', network: 'Slack' });
    expect(inDirectory(slack, 'network:Slack', empty)).toBe(true);
    expect(inDirectory(slack, 'network:matrix', empty)).toBe(false);

    const archived = { prefs: { s: { archived: true } }, readAt: {} };
    expect(inDirectory(slack, 'network:Slack', archived)).toBe(false);
    expect(inDirectory(slack, 'archive', archived)).toBe(true);
  });
});

describe('inboxRows', () => {
  const folded = (network: string) => network !== 'nostr';
  const all = () => true;

  it('folds other networks into one row where their latest chat sits', () => {
    const ordered = [
      conversation({ id: 's1', protocol: 'matrix', network: 'Slack' }),
      conversation({ id: 'n1', protocol: 'nostr' }),
      conversation({ id: 't1', protocol: 'telegram' }),
      conversation({ id: 's2', protocol: 'matrix', network: 'Slack' }),
      conversation({ id: 'bot', protocol: 'local' }),
    ];
    expect(shape(inboxRows(ordered, all, folded, empty))).toEqual([
      'network:Slack[s1,s2]',
      'n1',
      'network:telegram[t1]',
      'bot',
    ]);
  });

  it('puts Archive first and keeps archived chats out of the rest', () => {
    const ordered = [
      conversation({ id: 'n1', protocol: 'nostr' }),
      conversation({ id: 's1', protocol: 'matrix', network: 'Slack' }),
    ];
    const context = { prefs: { s1: { archived: true } }, readAt: {} };
    expect(shape(inboxRows(ordered, all, folded, context))).toEqual(['archive[s1]', 'n1']);
  });

  it('leaves a pinned chat out of its folder', () => {
    const ordered = [
      conversation({ id: 's1', protocol: 'matrix', network: 'Slack' }),
      conversation({ id: 's2', protocol: 'matrix', network: 'Slack' }),
    ];
    const context = { prefs: { s1: { pinned: true } }, readAt: {} };
    expect(shape(inboxRows(ordered, all, folded, context))).toEqual(['s1', 'network:Slack[s2]']);
  });

  it('shows a folder only when something in it passes the filter', () => {
    const ordered = [
      conversation({ id: 's1', protocol: 'matrix', network: 'Slack', kind: 'group' }),
      conversation({ id: 't1', protocol: 'telegram' }),
    ];
    const direct = (c: Conversation) => matchesFilter(c, 'direct', empty);
    expect(shape(inboxRows(ordered, direct, folded, empty))).toEqual(['network:telegram[t1]']);
  });
});
