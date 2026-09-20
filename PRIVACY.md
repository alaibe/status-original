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

Blockchain reads and transactions go from your device to a public endpoint
for that network, or to one you set with `/rpc`. That endpoint sees the
addresses you look at and the transactions you send.

Prices come from a public market data endpoint with no account and no
identifier. Token balances use Alchemy and GIF search uses Tenor, each only if
you enter your own key for it.

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

Last updated 2026-09-20.
