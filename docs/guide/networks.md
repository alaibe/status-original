# Networks

A conversation lives on one network. The app tells you which, and what that
network protects, on the conversation itself and in full under **Settings →
Protocols**, where each one is set up.

<div class="phones">
  <figure><img src="/screenshots/protocols.png" alt="Settings → Protocols: the five networks and their state"><figcaption>Settings → Protocols</figcaption></figure>
  <figure><img src="/screenshots/protocol-matrix.png" alt="The Matrix settings screen: what it protects, homeserver and Matrix ID"><figcaption>Each network says what it protects before you connect</figcaption></figure>
</div>

## At a glance

| Network | Who can read your messages | To reach someone you need | History on a new device |
| --- | --- | --- | --- |
| **XMTP** | Only the people in the chat. Relays see that two inboxes talk, not what they say. | An Ethereum address or ENS name that has opened an XMTP app | Comes back from the network |
| **Nostr** | Only the recipient. Relays see who receives a message and when, never who sent it. | A public key (`npub…`) | Only what your relays still hold |
| **Waku** | Only the recipient. The node you use sees which topics you read, not the content. | A public key | No |
| **Telegram** | Telegram. Not end-to-end encrypted, same as the official app. | A `@username`, a `t.me` link, or a phone number in your contacts | Yes, from Telegram |
| **Matrix** | Only the room's members, in rooms with encryption on. The homeserver sees who talks to whom and when. | `@user:server` or a `matrix.to` link | Yes, from the homeserver; encrypted rooms also need the keys |

XMTP, Nostr and Waku work the moment your account exists, because your recovery
phrase is your identity on all three. Telegram and Matrix are accounts you
already have elsewhere, so you sign in to them.

## XMTP

Messages between Ethereum accounts, encrypted with MLS. Groups work, with
membership enforced by the protocol rather than by convention. The other person
must have opened an XMTP-capable app at least once; if they have not, the app
says so when you try to start the chat.

**Settings → XMTP network** switches between the production network and the
developer one. Two apps only see each other on the same one.

**Settings → Devices** lists the installations, phones and computers, that share
your inbox, and revokes one you no longer have.

## Nostr

Sealed direct messages, NIP-17: relays deliver them without learning who sent
them. Under **Settings → Protocols → Nostr** you choose which relays, one per
line; the defaults are public ones. More relays means better delivery and more
servers that see when you receive something.

Relays may drop messages or forget history, so a new device only sees what your
relays still have.

## Waku

Store-and-forward messaging through a single nwaku node that you name in its
settings. No node is provided. That node sees which topics this device reads
and writes and can withhold messages; it cannot read them. Groups are a shared
topic.

## Telegram

Your own Telegram account, in the same inbox: private chats and groups, with
replies, reactions, photos, files and voice notes. Channels are not shown.

<div class="phones">
  <figure><img src="/screenshots/protocol-telegram.png" alt="The Telegram settings screen: API ID and API hash"><figcaption>Telegram asks for your own API credentials</figcaption></figure>
</div>

1. Get an **API ID** and **API hash** at [my.telegram.org](https://my.telegram.org)
   → *API development tools*. Telegram issues every developer their own pair.
   This app ships none, so each person registers theirs; it takes a minute and
   nothing about it is shared.
2. Enter both under **Settings → Protocols → Telegram** and tap **Save and
   reconnect**.
3. The screen then asks for your **phone number**, the **code** Telegram sends
   to your other devices or by SMS, and your **two-step verification password**
   if you have one.

You appear in Telegram's *Active Sessions* like any other client. **Sign out**
on the same screen ends the session there and deletes Telegram's data from this
device.

::: info Not end-to-end encrypted
Telegram's servers hold and can read these chats, exactly as with the official
app. Secret Chats are not opened here. Every Telegram conversation says so.
:::

Telegram works everywhere except Android.

## Matrix

Your own Matrix account: encrypted rooms and DMs on any homeserver, plus
whatever that homeserver bridges in. See [WhatsApp, Signal &
friends](./bridges).

1. Under **Settings → Protocols → Matrix**, enter your **homeserver** URL (the
   server's address, such as `https://matrix.example.org`) and your **Matrix
   ID** (`@you:example.org`), then **Save and reconnect**.
2. Enter your **password** once. The app keeps a session token, not the
   password.

Room invitations arrive as [message requests](./chats#message-requests);
accepting joins the room. Rooms with encryption on are end-to-end encrypted. A
message sent before this device joined shows as waiting for its keys, which is
how Matrix encryption works rather than a fault.

Two things to check with whoever runs your homeserver:

- It must support **sliding sync** (Synapse 1.114 or newer, or the Conduit
  family). Element X needs the same thing.
- Sign-in must be by **password**. Servers that only offer a web sign-in, as
  matrix.org now does, are not supported yet.
