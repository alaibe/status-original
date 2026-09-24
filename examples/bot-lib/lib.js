import { Client } from '@xmtp/node-sdk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getRandomValues } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ETHEREUM = 0;
const CONSENT_UNKNOWN = 0;
const CONSENT_ALLOWED = 1;
const CONSENT_DENIED = 2;

const UI_CONTENT_TYPE = {
  authorityId: 'status-original.plugin',
  typeId: 'ui.widget',
  versionMajor: 1,
  versionMinor: 0,
};

const uiCodec = {
  contentType: UI_CONTENT_TYPE,
  encode: (content) => ({
    type: UI_CONTENT_TYPE,
    parameters: { encoding: 'UTF-8' },
    content: new TextEncoder().encode(JSON.stringify(content)),
    fallback: content.fallback,
  }),
  decode: (encoded) => JSON.parse(new TextDecoder().decode(encoded.content)),
  fallback: (content) => content.fallback,
  shouldPush: () => true,
};

export function card(fallback, title, icon, children) {
  return { fallback, widget: { kind: 'card', title, icon, children } };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function loadOrCreate(file, make) {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const value = make();
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

/**
 * `onMessage(text, reply)` only ever sees the owner's messages. `reply` takes
 * a string or a `card(...)`.
 */
export async function runBot({ id, name, description, onMessage, onReady }) {
  const dataDir = process.env.DATA_DIR || './data';
  const env = process.env.XMTP_ENV || 'production';
  const ownerAddress = required('OWNER').toLowerCase();
  mkdirSync(dataDir, { recursive: true });

  const account = privateKeyToAccount(loadOrCreate(join(dataDir, 'key'), generatePrivateKey));
  const dbEncryptionKey = Buffer.from(
    loadOrCreate(join(dataDir, 'db-key'), () =>
      Buffer.from(getRandomValues(new Uint8Array(32))).toString('hex')
    ),
    'hex'
  );

  const client = await Client.create(
    {
      type: 'EOA',
      getIdentifier: () => ({
        identifier: account.address.toLowerCase(),
        identifierKind: ETHEREUM,
      }),
      signMessage: async (message) =>
        Buffer.from((await account.signMessage({ message })).slice(2), 'hex'),
    },
    { dbEncryptionKey, dbPath: join(dataDir, `xmtp-${env}.db3`), env, codecs: [uiCodec] }
  );

  const ownerInboxId = await client.fetchInboxIdByIdentifier({
    identifier: ownerAddress,
    identifierKind: ETHEREUM,
  });
  if (!ownerInboxId) throw new Error(`OWNER ${ownerAddress} has no XMTP inbox on ${env}`);

  if (process.env.PUBLIC_DIR) {
    const dir = join(process.env.PUBLIC_DIR, '.well-known', 'status-bot');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({ address: account.address, inboxId: client.inboxId, name, description })
    );
  }

  console.log(`${name} ${account.address} on ${env}, answering ${ownerAddress} only`);

  const cursorFile = join(dataDir, 'cursor');
  let cursor = existsSync(cursorFile) ? BigInt(readFileSync(cursorFile, 'utf8')) : null;

  const send = (conversation) => (content) =>
    typeof content === 'string'
      ? conversation.sendText(content)
      : conversation.send(uiCodec.encode(content), { shouldPush: true });

  async function handle(message) {
    if (message.senderInboxId === client.inboxId) return;
    const conversation = await client.conversations.getConversationById(message.conversationId);
    if (!conversation) return;

    if (message.senderInboxId !== ownerInboxId) {
      if (conversation.consentState() === CONSENT_DENIED) return;
      await conversation.sendText('This bot is private.');
      conversation.updateConsentState(CONSENT_DENIED);
      return;
    }

    const text = typeof message.content === 'string' ? message.content.trim() : '';
    if (text) {
      try {
        await onMessage(text, send(conversation));
      } catch (error) {
        console.error('onMessage failed:', error.message);
        await conversation.sendText('Something went wrong on my side. Try again in a moment.');
      }
    }

    cursor = message.sentAtNs;
    writeFileSync(cursorFile, String(cursor));
  }

  await client.conversations.syncAll();
  if (cursor !== null) {
    const dm = client.conversations.getDmByInboxId(ownerInboxId);
    for (const message of (await dm?.messages({ sentAfterNs: cursor })) ?? []) {
      await handle(message);
    }
  }

  onReady?.({
    toOwner: async (content) => send(await client.conversations.createDm(ownerInboxId))(content),
  });

  const stream = await client.conversations.streamAllMessages({
    consentStates: [CONSENT_UNKNOWN, CONSENT_ALLOWED],
  });
  for await (const message of stream) {
    if (message) await handle(message).catch((error) => console.error(error.message));
  }
}
