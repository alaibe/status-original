import { configLines } from '@/core/messaging/config';
import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { guideUrl } from '@/lib/guide';

const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.nostr.net'].join('\n');

export const NOSTR_PROTOCOL = {
  id: 'nostr',
  docsUrl: guideUrl('networks', 'nostr'),
  label: 'Nostr',
  external: false,
  description: 'Sealed direct messages relayed by servers that never learn who sent them.',
  recipient: {
    label: 'Public key',
    placeholder: 'npub1… or 64-char hex',
    noun: 'a public key',
    hint: 'Add a public key: an npub or 64 hex characters.',
    unreachable: (input) =>
      `${input} is not a valid public key. ` +
      'Paste an npub or 64 hex characters; there is no directory to look a name up in.',
  },
  meta: {
    trustModel:
      'Relays see who receives each message and when, never who sent it or what it says. ' +
      'They can also drop messages or forget history.',
    properties: {
      endToEndEncrypted: true,
      forwardSecrecy: false,
      metadataPrivacy: 'medium',
      maxGroupSize: 50,
      groupModel: 'recipient-set',
      durableHistory: false,
    },
  },
  configSchema: {
    fields: [
      {
        key: 'relays',
        label: 'Relays',
        kind: 'lines',
        default: DEFAULT_RELAYS,
        help: 'One per line. More relays means better delivery and more servers seeing when you receive.',
        required: true,
      },
    ],
  },
  async connect({ derive, config, storage }) {
    const { NostrSession } = await import('./adapter');
    return NostrSession.connect({
      derive,
      relays: configLines(config.relays),
      store: storage.messages,
      storage,
    });
  },
} satisfies ProtocolDescriptor;
