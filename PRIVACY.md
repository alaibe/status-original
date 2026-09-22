# Privacy policy

Status Original is a messenger with no server of its own. Your account is a
recovery phrase on your device. There is no sign-up, and the developer runs
nothing that your messages, keys or contacts pass through.

## What the developer receives

One thing: performance data, through Expo's `expo-observe` library. It
reports how long the app took to start and to move between screens, and the
host name of the slowest network request made while the app was launching.
For this app that host is a messaging relay or, if you configured one, your
own blockchain endpoint. The data carries no account, name or address and is
not linked to you.

That is the whole list. The app has no analytics, no advertising, no crash
reporter that captures what you write, and no push notification service that
registers your device with anyone.

## What leaves your device, and to whom

Messages go to the network the conversation is on: XMTP, Nostr or Waku. They
are end-to-end encrypted. Relay operators see ciphertext and routing metadata
(who is talking to whom, roughly when, and from which network address). You
choose the relays in Settings.

Telegram is different, and only on if you sign in to it. Telegram chats are
not end-to-end encrypted: Telegram's servers hold and can read them, exactly
as with the official app. Signing in sends your phone number to Telegram,
and the app registers itself there under the API ID and hash you supply. The
Telegram database on this device is encrypted with its own key in the
keychain and is deleted when you sign out or erase the account.

Matrix is only on if you sign in to it. Messages go to the homeserver you
name; rooms that have encryption on are end-to-end encrypted with Olm and
Megolm, and the homeserver still sees who talks to whom and when. If your
homeserver runs a bridge to another network, the bridge decrypts what it
relays. Signing in sends your Matrix ID and password to that homeserver once;
the app keeps the session token, and the SDK's local store (history, keys,
downloaded media) encrypted with its own key from the keychain. Both are
deleted when you sign out or erase the account.

Blockchain reads and transactions go from your device to a public endpoint
for that network, or to one you set with `/rpc`. That endpoint sees the
addresses you look at and the transactions you send.

Prices come from a public market data endpoint with no account and no
identifier. Token balances use Alchemy and GIF search uses KLIPY, each only if
you enter your own key for it.

Link previews fetch the page behind a link in a message directly from that
site, to show its title, description and picture (for YouTube, its small
oEmbed answer instead of the page). The site then sees your network address
when the message arrives, not only when you tap the link. Settings → Privacy
turns this off. Previews are kept on the device for a week so a link is not
fetched again each time it scrolls into view. Links, phone numbers, email
addresses, places and wallet addresses are recognised on the device without
any request; a wallet address in a message is looked up on the blockchain
endpoint you already use, like `/balance` would.

## What stays on your device

Your recovery phrase and keys, in the system keychain, optionally behind
Face ID or the device passcode. Message history, in an encrypted database per
account. Your address book is read on the device to suggest people to invite
and is never uploaded. Erasing an account from Settings deletes all of it.

## Deleting your data

There is no account to delete on a server, because there is none. Erase the
account in the app to remove everything held on the device. Messages already
delivered to relays or to other people are outside the developer's reach, as
they are for any messenger.

## Contact

Open an issue at https://github.com/alaibe/status-original/issues.

Last updated 2026-09-21.
