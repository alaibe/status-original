# Messages

<div class="phones">
  <figure><img src="/screenshots/status-room.png" alt="A conversation with command chips above the composer"><figcaption>The composer, with the chips a room offers</figcaption></figure>
  <figure><img src="/screenshots/message-actions.png" alt="Long-pressing a message: reactions, reply, copy, forward"><figcaption>Long-press a message for its actions</figcaption></figure>
</div>

## Sending

Type and tap send. `/` at the start of the message opens the command picker;
the chips above the composer run the same commands. The paperclip offers your
**photo library**, **take a photo**, a **file** and **GIF** search; the
microphone records a voice note. Photos are compressed before they go.

A message that could not be sent shows as failed with **Try again** on it.
Nothing is sent twice.

## Replies, reactions, forwarding

Long-press a message (right-click on the Mac):

- **React** with an emoji. Reactions show under the message with who sent
  them.
- **Reply** quotes the message above yours; tapping the quote jumps to it.
- **Copy** the text.
- **Forward** to another conversation, on any network.

## Links and everything tappable

URLs, phone numbers, email addresses, wallet addresses, ENS names and map
coordinates are tappable in every message, with no network request.

A link also unfurls into a card: title, description and picture, a poster for
YouTube, a place that opens in Maps for a maps link. That card is fetched by
your device straight from the linked site, so the site learns your address as
soon as the message arrives. It is on by default and you can turn it off under
Settings → Privacy; [Settings](./settings#privacy) explains the trade-off.

With the wallet plugin on, tapping an Ethereum address or ENS name shows the
wallet's card for it: the name, the balance, and buttons to send to it or
open it on a block explorer.

## Read receipts

Off by default, and symmetric: with them off, the other person does not see
when you read their messages, and you do not see when they read yours. Turn
them on under Settings → Privacy. There is no "last seen" and no typing
indicator on any network, on purpose.

## Cards from plugins

Some messages are cards rather than text: a balance, a payment request, a
price alert, a bot's reply with buttons. A card carries its own plain-text
fallback, so someone whose app lacks the plugin still reads what it says.
