import { Platform } from 'react-native';

import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { guideUrl } from '@/lib/guide';
import { accountDirectory, eraseAccountDirectory } from '@/storage/media';
import {
  accountMatrixSessionKey,
  accountMatrixStorePassphrase,
  vaultDelete,
  vaultGet,
  vaultSet,
} from '@/storage/vault';

import type { MxSession } from './api';
import { USER_ID } from './ids';

/** What the homeserver lists for this app under Sessions. */
const DEVICE_NAME = `Status Original on ${Platform.select({ ios: 'iPhone', android: 'Android', default: 'Mac' })}`;

export const MATRIX_PROTOCOL = {
  id: 'matrix',
  docsUrl: guideUrl('networks', 'matrix'),
  label: 'Matrix',
  description:
    'Your Matrix account: encrypted rooms and DMs on any homeserver, plus whatever your ' +
    'homeserver bridges in (WhatsApp, Signal, Slack, iMessage…).',
  recipient: {
    label: 'Matrix ID',
    placeholder: '@alice:example.org',
    noun: 'a Matrix ID',
    hint: 'Add a Matrix ID like @alice:example.org, or a matrix.to link to a user.',
    unreachable: (input) =>
      `${input} did not match anyone on Matrix. ` +
      'Check the ID; some homeservers hide profiles from other servers.',
  },
  meta: {
    trustModel:
      'Rooms that turn encryption on are end-to-end encrypted with Olm/Megolm; your homeserver ' +
      'still sees who talks to whom and when. Bridged networks are decrypted by the bridge.',
    properties: {
      endToEndEncrypted: true,
      forwardSecrecy: false,
      metadataPrivacy: 'low',
      maxGroupSize: 'unbounded',
      groupModel: 'enforced',
      durableHistory: true,
    },
  },
  configSchema: {
    fields: [
      {
        key: 'homeserver',
        label: 'Homeserver',
        kind: 'text',
        placeholder: 'https://matrix.example.org',
        help: 'The server your account lives on. Its client URL, not the part after the colon in your ID.',
        required: true,
      },
      {
        key: 'userId',
        label: 'Matrix ID',
        kind: 'text',
        placeholder: '@you:example.org',
        help: 'Your full ID. The password is asked for once you save.',
        required: true,
      },
    ],
  },
  async connect({ accountId, config }) {
    const homeserverUrl = normaliseHomeserver(config.homeserver ?? '');
    const userId = config.userId?.trim() ?? '';
    if (!USER_ID.test(userId)) throw new Error('The Matrix ID must look like @you:example.org.');

    const sessionKey = accountMatrixSessionKey(accountId);
    const [{ MatrixSession }, { MatrixClient }, dataDirectory, storePassphrase, session] = await Promise.all([
      import('./adapter'),
      import('./client'),
      accountDirectory('matrix', accountId),
      accountMatrixStorePassphrase(accountId),
      readSession(sessionKey, userId, homeserverUrl),
    ]);
    return MatrixSession.connect({
      createApi: () => MatrixClient.create(),
      parameters: { dataDirectory, storePassphrase, homeserverUrl, userId, deviceName: DEVICE_NAME, session },
      persistSession: (next) => (next ? vaultSet(sessionKey, JSON.stringify(next)) : vaultDelete(sessionKey)),
    });
  },
  // A live session erases through the SDK instead; this covers accounts that are not open.
  async eraseLocalData({ accountId }) {
    await vaultDelete(accountMatrixSessionKey(accountId));
    await eraseAccountDirectory('matrix', accountId);
  },
} satisfies ProtocolDescriptor;

function normaliseHomeserver(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** A saved session only counts for the account and server it was made for. */
async function readSession(
  key: ReturnType<typeof accountMatrixSessionKey>,
  userId: string,
  homeserverUrl: string,
): Promise<MxSession | null> {
  const raw = await vaultGet(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as MxSession;
    if (session.userId === userId && normaliseHomeserver(session.homeserverUrl) === homeserverUrl) return session;
  } catch {}
  await vaultDelete(key);
  return null;
}
