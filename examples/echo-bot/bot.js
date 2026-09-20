/**
 * A bot for Status Original.
 *
 * A bot is an XMTP inbox that answers. There is no Bot API to register with,
 * no token and no server in the middle: this file, an address and a network
 * connection are the entire stack.
 *
 *   npm install
 *   XMTP_ENV=production node bot.js
 *
 * It prints its own address on startup. Add that in the app with
 * `/addbot <address> Echo`, then `/startbot <address>`.
 */
import { Client } from '@xmtp/node-sdk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getRandomValues } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY_FILE = '.bot-key';
const DB_KEY_FILE = '.bot-db-key';

/** Persisted so the bot keeps the same address across restarts. */
function loadOrCreate(file, make) {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const value = make();
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

const privateKey = loadOrCreate(KEY_FILE, generatePrivateKey);
const account = privateKeyToAccount(privateKey);

const dbEncryptionKey = Buffer.from(
  loadOrCreate(DB_KEY_FILE, () => Buffer.from(getRandomValues(new Uint8Array(32))).toString('hex')),
  'hex'
);

/** The same Signer shape the app builds: a string in, a signature out. */
const signer = {
  type: 'EOA',
  getIdentifier: () => ({ identifier: account.address.toLowerCase(), identifierKind: 0 }),
  signMessage: async (message) => {
    const signature = await account.signMessage({ message });
    return Buffer.from(signature.slice(2), 'hex');
  },
};

/**
 * The content type the app renders as a card with buttons.
 *
 * Buttons carry command strings. `/reply <text>` sends that text straight back
 * here, which is how an inline keyboard works without any callback protocol;
 * the answer arrives as an ordinary message.
 */
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
  }),
  decode: (encoded) => JSON.parse(new TextDecoder().decode(encoded.content)),
  fallback: (content) => content.fallback,
  shouldPush: () => true,
};

function menu() {
  return {
    fallback: 'Echo bot: pick an option',
    widget: {
      kind: 'card',
      title: 'Echo bot',
      icon: 'hardware-chip-outline',
      children: [
        { kind: 'text', text: 'Anything you send, I send back. Or pick one:' },
        {
          kind: 'actions',
          actions: [
            { label: 'Say hi', command: '/reply hi' },
            { label: 'Tell me the time', command: '/reply time', tone: 'neutral' },
          ],
        },
      ],
    },
  };
}

const client = await Client.create(signer, {
  dbEncryptionKey,
  env: process.env.XMTP_ENV ?? 'production',
  codecs: [uiCodec],
});

console.log('Bot address :', account.address);
console.log('Bot inbox   :', client.inboxId);
console.log('Network     :', process.env.XMTP_ENV ?? 'production');
console.log('\nAdd it in the app:  /addbot', account.address, 'Echo');

await client.conversations.sync();

for await (const message of await client.conversations.streamAllMessages()) {
  // Never answer yourself, or two bots in a room will not stop.
  if (!message || message.senderInboxId === client.inboxId) continue;

  const conversation = await client.conversations.getConversationById(message.conversationId);
  if (!conversation) continue;

  const text = typeof message.content === 'string' ? message.content.trim() : '';
  console.log('<-', text || '(non-text message)');

  if (text === '/start' || text === '/menu') {
    await conversation.send(menu(), UI_CONTENT_TYPE);
    continue;
  }
  if (text === 'time') {
    await conversation.send(`It is ${new Date().toLocaleTimeString()}.`);
    continue;
  }
  if (!text) continue;

  await conversation.send(`You said: ${text}`);
}
