import AsyncStorage from '@react-native-async-storage/async-storage';

import { createAccountStorage } from '@/storage/account';
import {
  countsFor,
  entriesFor,
  entriesOf,
  extractLinks,
  indexMessages,
  loadMediaIndex,
  saveMediaIndex,
} from './media-index';
import type { ChatMessage, MessageContent } from './types';

function message(id: string, content: MessageContent, sentAt = 1): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    senderId: 'a',
    sentAt,
    content,
    fromMe: false,
    status: 'sent',
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('extractLinks', () => {
  it('finds a url in a sentence', () => {
    expect(extractLinks('look at https://example.com now')).toEqual(['https://example.com']);
  });

  it('strips sentence punctuation from the end', () => {
    // A wrong link in a links tab looks like the app inventing data.
    expect(extractLinks('see https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(extractLinks('(https://example.com)')).toEqual(['https://example.com']);
  });

  it('finds several', () => {
    expect(extractLinks('https://a.com and https://b.com')).toHaveLength(2);
  });

  it('ignores text that merely looks like a domain', () => {
    expect(extractLinks('email me at bob@example.com, e.g. tomorrow')).toEqual([]);
  });
});

describe('entriesFor', () => {
  it('classifies a photo as media', () => {
    const [entry] = entriesFor(message('m1', { kind: 'image', uri: 'file://a.jpg' }));
    expect(entry.category).toBe('media');
  });

  it('separates gifs from photos', () => {
    // People look for a gif separately from a photo, so the tabs do too.
    const [byMime] = entriesFor(
      message('m1', { kind: 'image', uri: 'file://a', mimeType: 'image/gif' })
    );
    const [byName] = entriesFor(
      message('m2', { kind: 'image', uri: 'file://b.GIF', name: 'b.GIF' })
    );

    expect(byMime.category).toBe('gifs');
    expect(byName.category).toBe('gifs');
  });

  it('classifies files and voice notes', () => {
    expect(entriesFor(message('m1', { kind: 'file', uri: 'f', name: 'a.pdf' }))[0].category).toBe(
      'files'
    );
    expect(
      entriesFor(message('m2', { kind: 'voice', uri: 'v', durationMs: 1000 }))[0].category
    ).toBe('voice');
  });

  it('contributes nothing for an ordinary message', () => {
    expect(entriesFor(message('m1', { kind: 'text', text: 'hello' }))).toEqual([]);
  });
});

describe('indexMessages', () => {
  it('adds entries under their conversation', () => {
    const index = indexMessages({}, 'c1', [message('m1', { kind: 'image', uri: 'file://a.jpg' })]);
    expect(entriesOf(index, 'c1', 'media')).toHaveLength(1);
  });

  it('is idempotent, because a sync redelivers messages', () => {
    const one = message('m1', { kind: 'image', uri: 'file://a.jpg' });
    let index = indexMessages({}, 'c1', [one]);
    index = indexMessages(index, 'c1', [one]);

    expect(entriesOf(index, 'c1', 'media')).toHaveLength(1);
  });

  it('returns the same object when nothing was added', () => {
    // Cheap identity check keeps React from re-rendering the profile screen.
    const index = indexMessages({}, 'c1', [message('m1', { kind: 'text', text: 'hi' })]);
    expect(index).toEqual({});
  });

  it('orders newest first', () => {
    const index = indexMessages({}, 'c1', [
      message('m1', { kind: 'image', uri: 'a' }, 1),
      message('m2', { kind: 'image', uri: 'b' }, 9),
    ]);
    expect(entriesOf(index, 'c1', 'media').map((e) => e.messageId)).toEqual(['m2', 'm1']);
  });

  it('keeps conversations apart', () => {
    let index = indexMessages({}, 'c1', [message('m1', { kind: 'image', uri: 'a' })]);
    index = indexMessages(index, 'c2', [message('m2', { kind: 'image', uri: 'b' })]);

    expect(entriesOf(index, 'c1', 'media')).toHaveLength(1);
    expect(entriesOf(index, 'c2', 'media')).toHaveLength(1);
  });

  it('records every link in one message', () => {
    const index = indexMessages({}, 'c1', [
      message('m1', { kind: 'text', text: 'https://a.com and https://b.com' }),
    ]);
    expect(entriesOf(index, 'c1', 'links')).toHaveLength(2);
  });
});

describe('countsFor', () => {
  it('counts each category', () => {
    let index = indexMessages({}, 'c1', [
      message('m1', { kind: 'image', uri: 'a' }),
      message('m2', { kind: 'file', uri: 'f', name: 'a.pdf' }),
      message('m3', { kind: 'text', text: 'https://a.com' }),
    ]);
    expect(countsFor(index, 'c1')).toEqual({ media: 1, files: 1, voice: 0, links: 1, gifs: 0 });
  });
});

describe('persistence', () => {
  it('round-trips and is scoped per account', async () => {
    const a = createAccountStorage('acct-a');
    const b = createAccountStorage('acct-b');
    await saveMediaIndex(a, { c1: [{ messageId: 'm1', category: 'media', sentAt: 1, uri: 'a' }] });
    expect((await loadMediaIndex(a)).c1).toHaveLength(1);

    expect(await loadMediaIndex(b)).toEqual({});
  });

  it('survives corrupt storage', async () => {
    const storage = createAccountStorage('media-test');
    await AsyncStorage.setItem(storage.key('chat.mediaIndex'), '{{{');
    expect(await loadMediaIndex(storage)).toEqual({});
  });
});
