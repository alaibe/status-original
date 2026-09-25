import { foldReactions, hasReacted } from './reactions';
import type { ChatMessage } from './types';

function message(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'c1',
    senderId: 'alice',
    sentAt: 1,
    content: { kind: 'text', text: 'hi' },
    fromMe: false,
    status: 'sent',
    ...over,
  };
}

function reaction(
  id: string,
  targetId: string,
  emoji: string,
  action: 'added' | 'removed',
  by = 'bob'
) {
  return message({ id, senderId: by, content: { kind: 'reaction', targetId, emoji, action } });
}

describe('foldReactions', () => {
  it('attaches a reaction to its target and drops the reaction message', () => {
    const out = foldReactions([message({ id: 'm1' }), reaction('r1', 'm1', '👍', 'added')]);

    expect(out).toHaveLength(1);
    expect(out[0].reactions).toEqual({ '👍': ['bob'] });
  });

  it('handles a reaction that arrives before its target', () => {
    // A sync returns messages in whatever order the network had them, so this
    // is normal rather than exceptional.
    const out = foldReactions([reaction('r1', 'm1', '👍', 'added'), message({ id: 'm1' })]);

    expect(out).toHaveLength(1);
    expect(out[0].reactions).toEqual({ '👍': ['bob'] });
  });

  it('removes a reaction that was taken back', () => {
    const out = foldReactions([
      message({ id: 'm1' }),
      reaction('r1', 'm1', '👍', 'added'),
      reaction('r2', 'm1', '👍', 'removed'),
    ]);

    expect(out[0].reactions).toBeUndefined();
  });

  it('keeps an emoji another person still holds', () => {
    const out = foldReactions([
      message({ id: 'm1' }),
      reaction('r1', 'm1', '👍', 'added', 'bob'),
      reaction('r2', 'm1', '👍', 'added', 'carol'),
      reaction('r3', 'm1', '👍', 'removed', 'bob'),
    ]);

    expect(out[0].reactions).toEqual({ '👍': ['carol'] });
  });

  it('counts each person once per emoji', () => {
    const out = foldReactions([
      message({ id: 'm1' }),
      reaction('r1', 'm1', '👍', 'added'),
      reaction('r2', 'm1', '👍', 'added'),
    ]);

    expect(out[0].reactions).toEqual({ '👍': ['bob'] });
  });

  it('supports several emoji on one message', () => {
    const out = foldReactions([
      message({ id: 'm1' }),
      reaction('r1', 'm1', '👍', 'added', 'bob'),
      reaction('r2', 'm1', '❤️', 'added', 'carol'),
    ]);

    expect(out[0].reactions).toEqual({ '👍': ['bob'], '❤️': ['carol'] });
  });

  it('ignores a reaction pointing at nothing', () => {
    // The target may simply not be loaded yet; it must not crash or invent one.
    const out = foldReactions([message({ id: 'm1' }), reaction('r1', 'ghost', '👍', 'added')]);

    expect(out).toHaveLength(1);
    expect(out[0].reactions).toBeUndefined();
  });

  it('leaves ordinary messages untouched', () => {
    const input = [message({ id: 'm1' }), message({ id: 'm2' })];
    expect(foldReactions(input)).toEqual(input);
  });

  it('hands back the same reacted message while its reactions stay the same', () => {
    const target = message({ id: 'm1' });
    const first = foldReactions([target, reaction('r1', 'm1', '👍', 'added')]);
    const again = foldReactions([
      target,
      reaction('r1', 'm1', '👍', 'added'),
      message({ id: 'm2' }),
    ]);
    const changed = foldReactions([target, reaction('r1', 'm1', '❤️', 'added')]);

    expect(again[0]).toBe(first[0]);
    expect(changed[0]).not.toBe(first[0]);
  });
});

describe('hasReacted', () => {
  it('reports whether a person already reacted', () => {
    const [folded] = foldReactions([message({ id: 'm1' }), reaction('r1', 'm1', '👍', 'added')]);

    expect(hasReacted(folded, '👍', 'bob')).toBe(true);
    expect(hasReacted(folded, '👍', 'alice')).toBe(false);
    expect(hasReacted(folded, '❤️', 'bob')).toBe(false);
  });
});
