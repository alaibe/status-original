import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { loadDbEncryptionKey } from '@/core/identity/keyring';

export const XMTP_PROTOCOL = {
  id: 'xmtp',
  label: 'XMTP',
  description: 'Messages addressed to Ethereum accounts, encrypted with MLS.',
  docsUrl: 'https://xmtp.org',
  recipient: {
    label: 'Address or ENS name',
    placeholder: 'vitalik.eth or 0x…',
    noun: 'an address',
    hint: 'Add an Ethereum address or ENS name.',
    unreachable: (input) =>
      `${input} has no XMTP inbox yet, so they cannot receive messages. ` +
      'Ask them to open an XMTP app once.',
  },
  meta: {
    trustModel:
      'Nobody, including the network, can read your messages or reconstruct a group roster. ' +
      'Relays do see that two inboxes are talking.',
    properties: {
      endToEndEncrypted: true,
      forwardSecrecy: true,
      metadataPrivacy: 'medium',
      maxGroupSize: 'unbounded',
      groupModel: 'enforced',
      durableHistory: true,
    },
  },
  configSchema: {
    fields: [
      {
        key: 'env',
        label: 'Network',
        kind: 'text',
        placeholder: 'production',
        help: 'production or dev. Two clients only see each other on the same one.',
      },
    ],
  },
  async connect({ accountId, account, contentTypes, config }) {
    const [{ XmtpSession }, { createPluginCodec }, { loadOrCreateDbEncryptionKey }] =
      await Promise.all([
        import('./adapter'),
        import('./codec'),
        import('@/core/identity/keyring'),
      ]);
    const env = xmtpEnvironment(config.env);
    return XmtpSession.connect({
      accountId,
      account,
      dbEncryptionKey: await loadOrCreateDbEncryptionKey(accountId),
      codecs: contentTypes.map(createPluginCodec),
      env,
    });
  },
  async eraseLocalData({ accountId, address, config }) {
    const dbEncryptionKey = await loadDbEncryptionKey(accountId);
    if (!dbEncryptionKey) return;
    const { eraseXmtpLocalDatabase } = await import('./adapter');
    await eraseXmtpLocalDatabase({
      address,
      dbEncryptionKey,
      env: xmtpEnvironment(config.env),
    });
  },
} satisfies ProtocolDescriptor;

function xmtpEnvironment(value: string | undefined): 'dev' | 'local' | 'production' | undefined {
  const env = value?.trim();
  return env === 'dev' || env === 'local' || env === 'production' ? env : undefined;
}
