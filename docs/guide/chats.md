# Chats

Three tabs: **Chats**, **Contacts** and **Settings**. Chats is the inbox, and
every conversation in it says which network it is on.

<div class="phones">
  <figure><img src="/screenshots/chats.png" alt="The chat list"><figcaption>The chat list</figcaption></figure>
  <figure><img src="/screenshots/new-chat.png" alt="Starting a new chat: pick a network, paste who to talk to"><figcaption>New chat: a network, then who</figcaption></figure>
  <figure><img src="/screenshots/contacts.png" alt="The Contacts tab"><figcaption>Contacts</figcaption></figure>
</div>

## The Status room

A fresh install has exactly one conversation: the Status room. It lives on your
device and nowhere else. It answers `/commands`, explains what the app can do,
and is where plugins post their own messages. It also works as a notepad, since
nothing written there is sent anywhere.

## Start a chat

Tap the compose button at the top right of Chats.

1. **Pick a network.** Only connected networks are offered;
   [Networks](./networks) covers connecting each one.
2. **Say who.** What you paste depends on the network: an Ethereum address or
   ENS name for XMTP, a public key for Nostr or Waku, a `@username` or phone
   number for Telegram, a `@user:server` ID or a `matrix.to` link for Matrix.
3. **Add more people and a title** to make a group, where the network allows
   it.

The app checks the person can actually receive messages there before opening
the chat, and says so when they cannot. An Ethereum address that has never
opened an XMTP app, for instance, has no inbox to deliver to.

## Contacts

The Contacts tab lists the people you have talked to, across every network, and
is where you save a name against an address you will use again. **Invite
friends** reads your device address book to suggest who to ask, on the device
only. Nothing from it is uploaded.

## Message requests

A conversation someone else starts arrives under **Message requests** at the
top of the list, not in your chats. Open it, read it, then **Accept** or
**Ignore**. Until you accept, nothing you do is visible to the sender. A Matrix
room invitation arrives as a request too, and accepting it joins the room.

## Filters and search

The chips under the search field filter the list: **All**, **Unread**,
**Groups**, **Bots**, and one per network once you have more than one
connected. A filter only appears when there is something to put in it.

Search matches conversation titles and the most recent message of each, on this
device.

## Pin, archive, mute

Swipe a conversation, or long-press it, to pin it to the top, archive it out of
the way, or silence its notifications. Archived chats collect in a folder at the
bottom of the list. Muting also keeps a conversation out of the **Unread**
filter.

## Groups

Inside a group, `/members` lists who is in it, `/invite` and `/remove` change
the roster, `/rename` changes the title and `/leave` leaves.

What each of those means underneath depends on the network. XMTP enforces
membership cryptographically; a Nostr group is simply the set of recipients;
Matrix has room power levels; Waku groups are a shared topic. The app only
offers what the network can actually do.
