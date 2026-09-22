# Privacy policy

Status Original has no server. Your account is a recovery phrase on your device,
there is no sign-up, and the developer operates nothing that your messages, keys
or contacts pass through. This page is the complete account of what leaves your
device, and to whom.

## What the developer receives

Two things, both anonymous.

The first is performance data, through Expo's `expo-observe` library. It
reports how long the app took to start and to move between screens, plus the
host name of the slowest network request made during launch. For this app that
is a messaging relay, or your own blockchain endpoint if you set one. It carries no
account, name, address or message content, and it is not linked to you.

The second is a count of how many devices are running each version, which
follows from the update check described below. It is a number on a dashboard,
with no way back to a person.

That is the entire list. There is no analytics SDK, no advertising, no crash
reporter that captures what you write, and no push service that registers your
device with anyone. Notifications are generated locally.

## What leaves your device, and who sees it

### Messages

**XMTP, Nostr and Waku** carry end-to-end encrypted messages. Relay operators
see ciphertext and routing metadata: that two parties are communicating,
roughly when, and from which network address. Nostr relays additionally never
learn who sent a message, only who receives it. You choose the relays and the
Waku node under Settings → Protocols.

**Telegram** is different, and only active if you sign in. Telegram chats are
not end-to-end encrypted: Telegram's servers hold and can read them, exactly as
with the official app. Signing in sends your phone number to Telegram, and the
app identifies itself with the API ID and hash you registered yourself. The
Telegram database on this device is encrypted with its own key in the keychain
and is deleted when you sign out or erase the account.

**Matrix** is only active if you sign in. Messages go to the homeserver you
name. Rooms with encryption on are end-to-end encrypted with Olm and Megolm; the
homeserver still sees who talks to whom and when. If that homeserver runs a
bridge to another network, the bridge decrypts what it relays, on the machine
where it runs. Signing in sends your Matrix ID and password to the homeserver
once; the app then keeps only a session token, and the SDK's local store
(history, keys, downloaded media) is encrypted with its own key from the
keychain. Both are deleted when you sign out or erase the account.

### Money

Blockchain reads and transactions go from your device to a public endpoint for
that network, or to one you set with `/rpc`. That endpoint sees which addresses
you look at and which transactions you send.

Token balances are read from that same endpoint. On EVM chains the app asks each
contract on a token list bundled with it; on Solana it asks the node what the
address holds. No third party is told what you own, and no key is involved.

`/trade` asks [LI.FI](https://li.fi) for a quote, which shows LI.FI your address,
the tokens and the amount. It works without an account; a LI.FI key you enter
yourself only raises how often you may ask. The transaction is signed on your
device and broadcast through the blockchain endpoint like any other. Releasing a
token to the route is usually a signature rather than a transaction, either the
token's own `permit` or Uniswap's Permit2, and neither reveals more than the
trade already does.

Prices come from a public market data endpoint (Binance's, by default; `/marketapi`
changes it) with no account and no identifier attached.

### Links and attachments

Link previews fetch the page behind a link directly from that site, to show its
title, description and picture. For YouTube it fetches the small oEmbed response
instead of the page. This means the site sees your network address when the message
*arrives*, not only if you tap it. It is on by default and Settings → Privacy
turns it off. Results are cached on the device for a week so the same link is
not re-fetched as it scrolls past.

Links, phone numbers, email addresses, places and wallet addresses are
recognised on the device with no request at all. A wallet address found in a
message is looked up through the blockchain endpoint you already use, exactly as
`/balance` would.

GIF search uses KLIPY, and only if you enter your own key for it.

### App updates

On iPhone and Android, the app asks Expo's update service (`u.expo.dev`) at
each launch whether a newer version of its own code exists, and uses what it
finds from the next launch. That is how a fix reaches you without waiting for
an app store review.

The request says which platform, which release channel and which build; Expo
sees the network address it came from, as any server does. It carries no
account, address, phone number or anything from your conversations.

The desktop app checks GitHub instead, and replaces itself only after
verifying a signature.

### What is never sent

There is no last-seen and no typing indicator. The protocols carry no presence
and the app does not add a side channel to broadcast one. Read receipts are off
by default and symmetric: with them off you do not see the other person's
either. Your address book is read on the device to suggest who to invite and is
never uploaded.

## What stays on your device

Your recovery phrase and keys, in the system keychain, optionally sealed behind
Face ID or the device passcode. Message history, in an encrypted database per
account. Downloaded media, in per-account directories. Preferences, per account.

## Deleting your data

There is no server-side account to delete, because there is none to begin with.
**Settings → Erase this account** removes the keys, the databases, the media and
the settings from this device, and signs out of Telegram and Matrix if they were
connected. It does not delete anything held by those networks, and it does not
affect the recovery phrase you wrote down. The same phrase restores the same
account later.

Messages already delivered to relays or to other people are beyond the
developer's reach, as they are with any messenger.

## Children

The app is not directed at children and collects nothing that would identify
anyone, of any age.

## Changes

This policy is a file in a public repository, so every change to it is a visible
commit. Material changes will be noted in the app's release notes.

## Contact

Open an issue at
[github.com/alaibe/status-original/issues](https://github.com/alaibe/status-original/issues).
For anything security-sensitive, use the private route in
[SECURITY.md](https://github.com/alaibe/status-original/blob/main/SECURITY.md)
instead.

Last updated 2026-09-22.
