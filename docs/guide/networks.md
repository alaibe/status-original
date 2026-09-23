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

Unread badges use each network's available history: Telegram and Matrix report
their counts, while XMTP, Waku and Nostr count locally available messages since
you last read the chat.

## XMTP

Messages between Ethereum accounts, encrypted with MLS. Groups work, with
membership enforced by the protocol rather than by convention. The other person
must have opened an XMTP-capable app at least once; if they have not, the app
says so when you try to start the chat.

**Settings → XMTP network** switches between the production network and the
developer one. Two apps only see each other on the same one.

**Settings → Devices** lists the installations, phones and computers, that share
your inbox, and revokes one you no longer have.

Group details show the description, image and member count when set. On phones,
you can request deletion of a message you sent; XMTP deletion asks clients to
hide it and does not erase copies already held by nodes or recipients. The
current desktop SDK can receive deletion notices but cannot initiate them.
XMTP has no built-in public room directory or enforced admin-only posting.
Invite links can be built with an app service, but are not a protocol-native
public join flow.

## Nostr

Sealed direct messages, NIP-17: relays deliver them without learning who sent
them. Under **Settings → Protocols → Nostr** you choose which relays, one per
line; the defaults are public ones. More relays means better delivery and more
servers that see when you receive something.

Relays may drop messages or forget history, so a new device only sees what your
relays still have.

This app uses NIP-17 private chats, including recipient-set groups. NIP-17 has
no public group identifier or admin moderation. NIP-29 relay groups are a
different protocol and are not connected here. NIP-17 permits advisory deletion
events, but this adapter does not yet send or apply them.

## Waku

Store-and-forward messaging through a single nwaku node that you name in its
settings. No node is provided. That node sees which topics this device reads
and writes and can withhold messages; it cannot read them. Groups are a shared
topic.

Waku transports encrypted payloads. It does not define native polls, edits,
deletions, pins, presence, or posting rights for this app's chats. Those would
need an app-level message format understood by every participating client.

## Telegram

Your own Telegram account, in the same inbox: private chats, groups and
channels, with replies, reactions, photos, video, files and voice notes. You can edit
your own text, delete a message for everyone when Telegram allows it, and delete
any message for yourself only. Group admins can delete other people's messages.
Polls in Telegram chats show results and let you vote.
In a Telegram group or channel where you can post, use `/poll "Question" "First choice" "Second choice"` to create an anonymous single-choice poll.
You can search messages in one chat or across chats. Telegram searches its history;
other networks search stored and loaded messages.
In Telegram groups, typing `@` suggests members, with or without a username. The
Mentions filter shows chats with unread Telegram mentions or replies.
You can pin messages where the chat allows it and open the pinned list from the
top of a chat.
Typing and available online or last-seen status appear for private chats.
Drafts and chats marked unread are saved to your Telegram account, so they
follow you to your other devices.
Channels are read-only for members; administrators can post.
Group and channel details show the description, link, photo and member count
when Telegram provides them.
You can preview a public Telegram group or channel by @username or t.me link
from New message, then join it.
Private invite links can also be previewed there. Links that require approval
send a join request instead of opening the chat immediately.
Group and channel administrators can create regular invite links or links that
require approval from the details screen.
Administrators can approve or decline pending join requests there, and the
chat's title bar counts them as they arrive.
Supergroup administrators with restriction rights can set slow mode in group
details, and can mute, remove or ban a member from the member's profile.

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

Matrix rooms support edits, redactions, pins, mentions, typing, video and polls.
Private chats show online or last seen when the homeserver shares presence.
Search reaches the homeserver's history for rooms without encryption.
Chats marked unread are saved to your Matrix account.
Room admins can create a link to the room. A link that needs approval lets
people knock, and their requests wait under Join requests in the room's
details. Admins can also mute, remove or ban a member; muting lowers the
member's power level below what sending needs.
Use `/poll "Question" "First choice" "Second choice"` in a room where you can
post. A room alias, ID or matrix.to link can be previewed from New message;
public rooms can be joined, and rooms with knock enabled accept a join request.
An unjoined public preview is labelled “Room” because posting rights are only
known once room state is available; a joined broadcast room is labelled
“Channel.”
Room details show the topic, avatar, link and member count. Posting rights come
from Matrix room power levels, so rooms with restricted posting appear as
channels with a read-only composer for members.

For a room bridged to another service, these are Matrix-side capabilities. A
bridge must translate each action to the remote service; support varies by the
specific bridge, its configuration and the remote service's API. For example,
a Matrix poll may remain in the Matrix room without becoming a poll on the
remote network. See [bridges](./bridges).

Two things to check with whoever runs your homeserver:

- It must support **sliding sync** (Synapse 1.114 or newer, or the Conduit
  family). Element X needs the same thing.
- Sign-in must be by **password**. Servers that only offer a web sign-in, as
  matrix.org now does, are not supported yet.
