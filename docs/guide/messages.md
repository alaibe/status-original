# Messages

<div class="phones">
  <figure><img src="/screenshots/status-room.png" alt="A conversation with command chips above the composer"><figcaption>The composer, with the chips a room offers</figcaption></figure>
  <figure><img src="/screenshots/message-actions.png" alt="Long-pressing a message: reactions, reply, copy, forward"><figcaption>Long-press a message for its actions</figcaption></figure>
</div>

## Sending

Type and tap send. A `/` at the start of the message opens the command picker;
the chips above the composer run the same commands without typing.

The paperclip offers your **photo library**, **take a photo**, a **file**, and
**GIF** search. The microphone records a voice note. Photos are compressed
before they go.

A message that could not be sent is marked as failed, with **Try again** on it.
Nothing is ever sent twice.

## Replies, reactions, forwarding

Long-press a message, or right-click on the Mac:

- **React** with 👍 ❤️ 😂 😮 😢 🙏 or any other emoji. Reactions show under the
  message with who sent them.
- **Reply** quotes the message above yours; tapping the quote jumps back to it.
- **Copy** the text.
- **Forward** to another conversation, on any network.

## Links and everything tappable

URLs, phone numbers, email addresses, wallet addresses, ENS names and map
coordinates are tappable in every message. Recognising them takes no network
request at all, because it happens on the device.

A link also unfurls into a card: title, description and picture, a poster for
YouTube, a place that opens in Maps for a maps link. That card is fetched by
**your device, straight from the linked site**, so the site learns your network
address as soon as the message arrives, not only if you tap. It is on by
default; Settings → Privacy turns it off, and
[Settings](./settings#privacy) explains the trade.

With the wallet plugin on, tapping an Ethereum address or ENS name opens the
wallet's card for it: the name, the balance, and buttons to send to it or open
it on a block explorer.

## Read receipts

Off by default, and symmetric. With them off, the other person does not see
when you read their messages, and you do not see when they read yours. Turn
them on under Settings → Privacy.

There is no last-seen and no typing indicator on any network, deliberately. The
protocols carry no presence, and the app does not add a side channel to
broadcast when you are online or touching the keyboard.

## Cards from plugins

Some messages are cards rather than text: a balance, a payment request, a price
alert, a bot's reply with buttons. Every card carries its own plain-text
fallback, so someone whose app does not have that plugin still reads what it
said.

A card's buttons only ever run a command, through the same path as typing it. A
button labelled "send" still opens the normal confirmation.
