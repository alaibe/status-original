import AsyncStorage from '@react-native-async-storage/async-storage';

import { createAccountStorage } from '@/storage/account';
import {
  loadChatPrefs,
  orderConversations,
  saveChatPrefs,
  withPref,
  type ChatPrefsMap,
} from './chat-prefs';
import type { Conversation } from './types';

function conversation(id: string, sentAt: number): Conversation {
  return {
    id,
    kind: 'dm',
    title: id,
    memberIds: [],
    createdAt: 0,
    consent: 'allowed',
    lastMessage: {
      id: `${id}-m`,
      conversationId: id,
      senderId: 'a',
      sentAt,
      content: { kind: 'text', text: 'hi' },
      fromMe: false,
      status: 'sent',
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('withPref', () => {
  it('sets a flag', () => {
    expect(withPref({}, 'c1', { pinned: true })).toEqual({ c1: { pinned: true } });
  });

  it('drops the entry when nothing is left to remember', () => {
    // Otherwise un-pinning leaves `{ pinned: false }` behind forever and the
    // map grows by one entry per conversation ever touched.
    const prefs = withPref({}, 'c1', { pinned: true });
    expect(withPref(prefs, 'c1', { pinned: false })).toEqual({});
  });

  it('keeps other flags when one is cleared', () => {
    let prefs: ChatPrefsMap = withPref({}, 'c1', { pinned: true });
    prefs = withPref(prefs, 'c1', { muted: true });
    prefs = withPref(prefs, 'c1', { pinned: false });

    expect(prefs).toEqual({ c1: { muted: true } });
  });

  it('leaves other conversations alone', () => {
    const prefs = withPref({ c2: { muted: true } }, 'c1', { pinned: true });
    expect(prefs.c2).toEqual({ muted: true });
  });
});

describe('orderConversations', () => {
  it('puts pinned conversations first', () => {
    const list = [conversation('old', 1), conversation('new', 9)];
    const out = orderConversations(list, { old: { pinned: true } });

    expect(out.map((c) => c.id)).toEqual(['old', 'new']);
  });

  it('sorts by recency within each group', () => {
    const list = [conversation('a', 1), conversation('b', 5), conversation('c', 3)];
    expect(orderConversations(list, {}).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('removes archived conversations rather than sinking them', () => {
    const list = [conversation('a', 5), conversation('b', 1)];
    expect(orderConversations(list, { a: { archived: true } }).map((c) => c.id)).toEqual(['b']);
  });

  it('can include archived when the archive is being viewed', () => {
    const list = [conversation('a', 5), conversation('b', 1)];
    const out = orderConversations(list, { a: { archived: true } }, { includeArchived: true });
    expect(out).toHaveLength(2);
  });
});

describe('persistence', () => {
  const storage = createAccountStorage('prefs-test');
  it('round-trips', async () => {
    await saveChatPrefs(storage, { c1: { pinned: true } });
    expect(await loadChatPrefs(storage)).toEqual({ c1: { pinned: true } });
  });

  it('returns an empty map when nothing is stored', async () => {
    expect(await loadChatPrefs(storage)).toEqual({});
  });

  it('survives corrupt storage', async () => {
    await AsyncStorage.setItem(storage.key('chat.prefs'), 'not json');
    expect(await loadChatPrefs(storage)).toEqual({});
  });

  it('is scoped per account', async () => {
    const a = createAccountStorage('acct-a');
    const b = createAccountStorage('acct-b');
    await saveChatPrefs(a, { c1: { pinned: true } });

    expect(await loadChatPrefs(b)).toEqual({});

    expect(await loadChatPrefs(a)).toEqual({ c1: { pinned: true } });
  });
});
