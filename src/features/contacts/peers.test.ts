import type { Conversation } from '@/core/messaging/types';

import { peersOf } from './peers';

/**
 * Pinned after React complained: the same peer appeared once per DM held with
 * them, which rendered as two rows with the same name and the same avatar and
 * reported "two children with the same key" in the console.
 */
const dm = (over: Partial<Conversation>): Conversation =>
  ({
    id: 'x',
    kind: 'dm',
    protocol: 'nostr',
    memberIds: ['me', 'them'],
    consent: 'allowed',
    createdAt: 0,
    title: '',
    ...over,
  }) as Conversation;

const self = () => 'me';

describe('the people behind a list of conversations', () => {
  it('shows a person once, however many threads you have with them', () => {
    const peers = peersOf(
      [
        dm({ id: 'nostr-newest', memberIds: ['me', 'them'] }),
        dm({ id: 'nostr-older', memberIds: ['me', 'them'] }),
      ],
      self
    );

    expect(peers).toHaveLength(1);
  });

  it('keeps the most recent thread, which is the one tapping opens', () => {
    const peers = peersOf([dm({ id: 'nostr-newest' }), dm({ id: 'nostr-older' })], self);

    expect(peers[0].conversationId).toBe('nostr-newest');
  });

  /**
   * Two protocols is two identities with two different keys. Collapsing them
   * into one row would claim a link the app cannot verify.
   */
  it('keeps the same name on two protocols apart', () => {
    const peers = peersOf(
      [dm({ id: 'nostr-1', protocol: 'nostr' }), dm({ id: 'xmtp-1', protocol: 'xmtp' })],
      self
    );

    expect(peers.map((p) => p.protocol)).toEqual(['nostr', 'xmtp']);
  });

  it('never lists you', () => {
    expect(peersOf([dm({ memberIds: ['me'] })], self)).toEqual([]);
  });

  it('leaves out groups, declined threads and local rooms', () => {
    const peers = peersOf(
      [
        dm({ id: 'group-1', kind: 'group', memberIds: ['me', 'a'] }),
        dm({ id: 'nostr-declined', memberIds: ['me', 'b'], consent: 'denied' }),
        dm({ id: 'local-wallet', memberIds: ['me', 'wallet'] }),
        dm({ id: 'nostr-real', memberIds: ['me', 'c'] }),
      ],
      self
    );

    expect(peers.map((p) => p.id)).toEqual(['c']);
  });

  /** Every row needs a key React can tell apart. That was the reported bug. */
  it('produces one unique key per row', () => {
    const peers = peersOf(
      [
        dm({ id: 'nostr-1', memberIds: ['me', 'a'] }),
        dm({ id: 'nostr-2', memberIds: ['me', 'a'] }),
        dm({ id: 'nostr-3', memberIds: ['me', 'b'] }),
        dm({ id: 'xmtp-1', protocol: 'xmtp', memberIds: ['me', 'a'] }),
      ],
      self
    );

    const keys = peers.map((p) => `${p.protocol}-${p.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['nostr-a', 'nostr-b', 'xmtp-a']);
  });
});
