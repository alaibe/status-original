# FAQ

## I lost my phone. Is my account gone?

No, as long as you have the twelve words. Install the app on another device,
tap **I already have a recovery phrase**, and your account, addresses and
wallet are back. Chat history is a different matter: XMTP restores from the
network, Telegram and Matrix from their servers, Nostr only what your relays
still hold, Waku nothing. See [Networks](./guide/networks).

## I lost the twelve words.

While the app is still open on a device that has the account, Settings →
**Recovery phrase** shows them again. Write them down now. If the device is
gone too, so is the account; nobody can recover it, because nobody else ever
had it.

## Why does the app start almost empty?

Because it is a messenger first. The wallet, market alerts, the dapp browser
and bots are plugins that ship switched off, each saying what it adds and what
it may reach. Turn them on under Settings → **Plugins**. Nothing makes a
network request until you do.

## Why does Telegram ask me for an API ID?

Telegram requires every client to identify itself with a developer's API ID
and hash. Rather than shipping one for everyone, which Telegram could
rate-limit or revoke for every user at once, the app asks each person to
register their own at [my.telegram.org](https://my.telegram.org). It takes a
minute and nothing about it is shared.

## Matrix says my homeserver is not supported.

The app needs a homeserver with **sliding sync** (Synapse 1.114 or newer, or
the Conduit family), the same requirement as Element X. Ask whoever runs the
server. Separately, a server that only signs in through a web page (as
matrix.org does now) does not work yet; one with password sign-in does.

## A Matrix message says "Waiting for the keys".

It was sent to the room before this device joined it, or before this device
existed, so its encryption key was never shared with you. That is how Matrix
end-to-end encryption works, not a fault. New messages arrive readable.

## Can I message someone on WhatsApp or Signal?

Not from the app directly, because those networks do not allow it. You can
through a Matrix homeserver that runs a bridge;
[WhatsApp, Signal & friends](./guide/bridges) explains what that involves.

## Who can see my messages?

It depends on the network, and the app says on every conversation. In short:
on XMTP, Nostr and Waku, only the people in the chat; on Matrix, the room's
members, in rooms with encryption on; on Telegram, Telegram. The
[Privacy](./privacy) page lists everything that leaves your device.

## Does the app collect anything?

Anonymous performance data only: how long the app took to start, and the host
of the slowest request while it did. No account, no identifier, no content.
Balances go from your device to a public blockchain endpoint (or one you
set), prices to a public market endpoint, link previews to the linked site.

## Where is Android?

The Android build exists but has not been tested on a device yet. iOS and
the Mac are what the app is checked on today.
