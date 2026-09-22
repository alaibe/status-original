import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { guideUrl } from '@/lib/guide';

export const WAKU_PROTOCOL = {
  id: 'waku',
  docsUrl: guideUrl('networks', 'waku'),
  label: 'Waku',
  description: 'Store-and-forward messaging through an nwaku node you supply.',
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
      'Runs through one nwaku node you choose. That node sees which topics this device reads ' +
      'and writes, and can withhold messages; it cannot read them.',
    properties: {
      endToEndEncrypted: true,
      forwardSecrecy: false,
      metadataPrivacy: 'low',
      maxGroupSize: 'unbounded',
      groupModel: 'topic',
      durableHistory: false,
    },
  },
  configSchema: {
    fields: [
      {
        key: 'nodeUrl',
        label: 'nwaku node URL',
        kind: 'text',
        placeholder: 'http://127.0.0.1:8645',
        help: 'The REST endpoint of a node you run or trust. No node is provided; this one sees your traffic patterns.',
        required: true,
      },
    ],
  },
  async connect({ derive, config, storage }) {
    const { WakuSession } = await import('./adapter');
    return WakuSession.connect({
      derive,
      nodeUrl: config.nodeUrl ?? '',
      store: storage.messages,
    });
  },
} satisfies ProtocolDescriptor;
