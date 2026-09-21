import Constants from 'expo-constants';
import { Directory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ProtocolDescriptor } from '@/core/messaging/registry';
import { accountTdlibDatabaseKey } from '@/storage/vault';

export const TELEGRAM_PROTOCOL = {
  id: 'telegram',
  docsUrl: 'https://core.telegram.org/api/obtaining_api_id',
  label: 'Telegram',
  description: 'Your Telegram account: private chats and groups, signed in with your phone number.',
  recipient: {
    label: 'Username or phone number',
    placeholder: '@username or +44…',
    noun: 'a username',
    hint: 'Add a Telegram @username, a t.me link, or a phone number with its country code.',
    unreachable: (input) =>
      `${input} did not match anyone on Telegram. ` +
      'Usernames are public; a phone number only resolves if it is in your contacts or allows lookup.',
  },
  meta: {
    trustModel:
      'Telegram stores every chat on its servers and can read them. Only Secret Chats are ' +
      'end-to-end encrypted, and this app does not open those.',
    properties: {
      endToEndEncrypted: false,
      forwardSecrecy: false,
      metadataPrivacy: 'low',
      maxGroupSize: 200_000,
      groupModel: 'enforced',
      durableHistory: true,
    },
  },
  configSchema: {
    fields: [
      {
        key: 'apiId',
        label: 'API ID',
        kind: 'text',
        placeholder: '12345678',
        help: 'From my.telegram.org → API development tools. Each user registers their own; nothing is shared.',
        required: true,
      },
      {
        key: 'apiHash',
        label: 'API hash',
        kind: 'secret',
        placeholder: '32 hex characters',
        help: 'From the same page. Stored in the keychain with your other keys.',
        required: true,
      },
    ],
  },
  async connect({ accountId, config }) {
    const [{ TelegramSession }, { TdClient }] = await Promise.all([
      import('./adapter'),
      import('./td-client'),
    ]);
    const apiId = Number(config.apiId?.trim());
    if (!Number.isInteger(apiId) || apiId <= 0) throw new Error('The API ID must be a whole number.');

    return TelegramSession.connect({
      createApi: () => TdClient.create(),
      parameters: {
        databaseDirectory: databaseDirectory(accountId).uri.replace(/^file:\/\//, ''),
        apiId,
        apiHash: config.apiHash?.trim() ?? '',
        databaseEncryptionKey: await accountTdlibDatabaseKey(accountId),
        deviceModel: Platform.OS === 'ios' ? 'iPhone' : 'Android',
        systemVersion: String(Platform.Version),
        applicationVersion: Constants.expoConfig?.version ?? '1.0',
      },
    });
  },
  // A live session destroys through TDLib instead; this covers accounts that are not open.
  async eraseLocalData({ accountId }) {
    const dir = new Directory(Paths.document, 'tdlib', accountId);
    if (dir.exists) dir.delete();
  },
} satisfies ProtocolDescriptor;

function databaseDirectory(accountId: string): Directory {
  const dir = new Directory(Paths.document, 'tdlib', accountId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}
