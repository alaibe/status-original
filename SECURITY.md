# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on
[alaibe/status-original](https://github.com/alaibe/status-original/security/advisories/new).
Do not open a public issue, and do not post a proof of concept anywhere public
until there is a fix.

Include what an attacker gains, the steps to reproduce it, and which build you
saw it on. Expect a first reply within a week. This is a single-maintainer
project with no bug bounty; what it can offer is that the report is taken
seriously and credited in the advisory unless you would rather it were not.

## What is in scope

Anything in this repository, and the way it uses its dependencies:

- key generation, storage and use: `src/core/identity`, `src/storage/vault.ts`
- the local databases and the account erase path: `src/storage`
- protocol adapters and anything that crosses the wire: `src/protocols`
- the plugin sandbox, its permission model and the command dispatcher:
  `src/core/plugins`, `src/core/commands`
- transaction and signature review, and what gets signed:
  `src/plugins/wallet`, `src/plugins/browser`
- the Rust side of the desktop app: `src-tauri/src`

## What is not

The networks themselves. XMTP, Nostr, Waku, Telegram, Matrix, LI.FI, the
blockchain endpoints and any bridge a homeserver runs have their own reporting
channels. In scope here is this app trusting one of them more than it should,
or describing its guarantees inaccurately in the interface.

A bot, a dapp or a homeserver behaving badly. Nobody vets bots, and one sees
everything you send it. A bot's buttons carry command strings and dispatch
through the same path as typing, so a button labelled "send 10 ETH" still opens
the ordinary confirmation. A button that skips that confirmation is a real
finding.

## The design, in short

The account is the phrase. Twelve BIP-39 words generated on the device by
viem. Every identity follows from it: the messaging keys on XMTP, Nostr and
Waku, and the Ethereum, Bitcoin and Solana addresses. There is no server-side
account, so there is nothing to reset, nothing to take over, and no recovery if
the phrase is lost.

Secrets never leave the keychain. Recovery phrases, database keys,
credentials and protocol session tokens go to `expo-secure-store` as
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: not synced, not in a backup, and not readable
while the device is locked. Key protection moves the phrase into a second
keychain service with `requireAuthentication`, so Face ID or the passcode is
needed before the phrase or a signature is used.

Keys are separated by purpose. The phrase, the app's database key, XMTP's
database key, TDLib's database key and matrix-rust-sdk's store passphrase are
distinct entries, derived and stored per account. Compromising one does not
hand over the others.

Everything stored is encrypted. One SQLCipher database per account for
conversations and messages; XMTP, TDLib and matrix-rust-sdk keep their own
encrypted stores beside it. Erasing an account deletes the databases, the media
directories and the protocol stores before the keys, and signs out of Telegram
and Matrix on the way.

Signing is explicit. Sends, swaps, approvals and WalletConnect requests go
through a review screen that shows what will be signed, and nothing is signed
before you confirm. Hardware accounts confirm on the device, and the key never
reaches the phone.

Plugins are capability-scoped. A plugin declares its permissions in its
manifest, the person sees that list before enabling it, and the host revokes its
context on disable. Plugins ship off; a fresh install makes no network request
for any of them.

**On the desktop**, secrets live in a single AES-256-GCM file whose key is in
the OS credential store. Debug builds keep that key in a user-only file instead,
so unsigned rebuilds do not prompt on every launch. That also makes a debug
build the wrong place to keep a real account.

Mobile applies JavaScript updates without a store review. A build looks for a
new bundle at each launch and runs it from the next one. Native code cannot
arrive that way, and `runtimeVersion` fingerprints the native project, so an
update only reaches builds it matches. Whoever holds the EAS account can
therefore put code in front of the wallet and the recovery phrase, which makes
that account as sensitive as a signing certificate.

Plain web is not a supported target. The web export exists to run inside the
Tauri window. Opened in a browser it falls back to `localStorage` for secrets,
and the welcome screen says so.

## Known limitations

These are properties of the design rather than bugs, and the app states each one
where it matters:

- Telegram is not end-to-end encrypted. Telegram holds and can read those
  chats, as with the official client. Secret Chats are not implemented.
- **Matrix metadata is visible to the homeserver**, and a bridge decrypts
  whatever it relays on the machine where it runs.
- Relays see routing metadata. Nostr relays learn who receives a sealed
  message and when, never the sender. An nwaku node sees which topics a device
  reads and writes and can withhold messages. XMTP relays see that two inboxes
  are talking.
- **Link previews are fetched by your device**, so the linked site learns your
  network address as soon as the message arrives. On by default, with a switch
  under Settings → Privacy.
- **Blockchain reads go to an endpoint** that then knows which addresses you
  look at. `/rpc` points a chain at one you run instead.
- Android has not been security-reviewed. The key storage, database and
  erase paths there use the same code, but only iOS and macOS have been gone
  over.

[`PRIVACY.md`](PRIVACY.md) is the exhaustive list of what leaves the device and
to whom.
