# Chats

The app has three tabs: **Chats**, **Contacts** and **Settings**. Chats is the
inbox, and every conversation in it says which network it is on.

<div class="phones">
  <figure><img src="/screenshots/chats.png" alt="The chat list"><figcaption>The chat list</figcaption></figure>
  <figure><img src="/screenshots/new-chat.png" alt="Starting a new chat: pick a network, paste who to talk to"><figcaption>New chat: a network, then who</figcaption></figure>
  <figure><img src="/screenshots/contacts.png" alt="The Contacts tab"><figcaption>Contacts</figcaption></figure>
</div>

## The Status room

A fresh install has one conversation: the Status room. It is on your device
only. It answers `/commands`, explains features, and is where plugins post
their own messages. You can also use it as a notepad; nothing you write there
is sent anywhere.

## Start a chat

Tap the compose button at the top right of Chats.

1. Pick a network. Only networks that are connected are offered;
   [Networks](./networks) explains how to connect each one.
2. Say who. What you paste depends on the network: an Ethereum address or
   ENS name for XMTP, a public key for Nostr or Waku, a `@username` or phone
   number for Telegram, a `@user:server` ID or `matrix.to` link for Matrix.
3. Add more people and a title to make a group, where the network allows it.

The app checks that the person can actually receive messages on that network
before it opens the chat, and tells you when they cannot (for example, an
Ethereum address that has never opened an XMTP app).

## Message requests

A conversation someone else starts lands under **Message requests** at the top
of the list, not in your chats. Open it, read it, and choose **Accept** or
**Ignore**. Until you accept, nothing you do is visible to the sender. On
Matrix, a room invitation is a request too.

## Filters and search

The chips under the search field filter the list: **All**, **Unread**,
**Groups** and **Bots**, and the folders only appear once there is something
to put in them. Search matches conversation titles and the latest message of
each, on this device.

## Pin, archive, mute

Swipe a conversation, or long-press it, for pinning it to the top, archiving
it out of the way, or silencing its notifications. Archived chats sit in a
folder at the bottom of the list.

## Groups

In a group, `/members` lists who is in it, `/invite` and `/remove` change
the roster, `/rename` changes the title and `/leave` leaves. What each does
underneath depends on the network. XMTP enforces membership
cryptographically, a Nostr group is the set of recipients, Matrix has room
power levels, and the app only offers what the network supports.
