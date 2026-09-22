import type { ChatMessage } from './types';

import { formatTimestamp, messagePreview } from './preview';

const base: ChatMessage = {
  id: '1',
  conversationId: 'c',
  senderId: 's',
  sentAt: 0,
  fromMe: false,
  status: 'sent',
  content: { kind: 'text', text: 'hello' },
};

describe('messagePreview', () => {
  it('describes an empty conversation', () => {
    expect(messagePreview(undefined)).toBe('No messages yet');
  });

  it('collapses whitespace in text so multi-line messages stay one line', () => {
    expect(messagePreview({ ...base, content: { kind: 'text', text: 'a\n\n  b ' } })).toBe('a b');
  });

  it('uses the plugin fallback for custom content', () => {
    expect(
      messagePreview({
        ...base,
        content: {
          kind: 'custom',
          typeId: 'eth.payment.request',
          data: {},
          fallback: 'Wants 1 ETH',
        },
      })
    ).toBe('Wants 1 ETH');
  });

  it('falls back gracefully when a plugin is disabled', () => {
    expect(
      messagePreview({
        ...base,
        content: {
          kind: 'unsupported',
          typeId: 'eth.payment.request',
          fallback: 'Payment request',
        },
      })
    ).toBe('Payment request');
  });
});

describe('formatTimestamp', () => {
  const now = new Date('2026-09-03T12:00:00Z').getTime();

  it('shows a clock time for messages sent today', () => {
    const earlier = new Date('2026-09-03T09:30:00Z').getTime();
    // Locale-dependent, so assert the shape rather than an exact string.
    expect(formatTimestamp(earlier, now)).toMatch(/\d/);
    expect(formatTimestamp(earlier, now)).not.toMatch(/Sep/);
  });

  it('shows a weekday within the last week', () => {
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    expect(formatTimestamp(threeDaysAgo, now)).toMatch(/^[A-Z][a-z]{2}$/);
  });

  it('shows a date beyond a week', () => {
    const longAgo = now - 30 * 24 * 60 * 60 * 1000;
    expect(formatTimestamp(longAgo, now)).toMatch(/[A-Za-z]{3}/);
  });
});
