# Settings

<div class="phones">
  <figure><img src="/screenshots/settings.png" alt="The Settings tab"><figcaption>Settings</figcaption></figure>
  <figure><img src="/screenshots/privacy.png" alt="Settings → Privacy: read receipts, link previews, and what is never collected"><figcaption>Privacy: two switches, and a list of what is not collected</figcaption></figure>
</div>

## Account

- **Accounts** lists every account on this device, and is where you add one
  or switch.
- **My QR code** shows your addresses as a code someone can scan to start a
  chat.
- **Recovery phrase** shows the phrase again and holds the security
  switches: *Require Face ID* to open the app, and *Also protect keys*,
  which seals the phrase in the keychain so nothing can read it without Face
  ID.
- **Erase this account** is covered under
  [Your account](./account#erase-an-account).

## Preferences

- **Appearance** sets light, dark or system, and the chat wallpaper.
- **Privacy** is below.
- **Trades** takes a LI.FI key for swaps and bridges. They work without
  one; the key only raises how often you can ask for a quote. See
  [Wallet](./wallet#swap-and-bridge).
- **GIFs** takes a KLIPY key for GIF search, optional too and under the same
  rule: no key ships with the app, and yours stays on this device.
- **Devices** lists the phones and computers signed in to your XMTP inbox,
  and revokes one you no longer have.

## Privacy

Two switches, and both default to the quiet option:

- **Send read receipts** is off. The other person does not see when you open
  their messages, and you do not see when they open yours.
- **Show link previews** is on. A link in a message becomes a card fetched
  by this device straight from the linked site, so the site learns your
  address as soon as the message arrives, before you tap anything. Turn it
  off to keep that to yourself.
  [Messages](./messages#links-and-everything-tappable) has the details.

Below the switches, the screen lists what the app does *not* do: no last seen,
no typing indicator, no contact upload. The networks carry no presence, and
the app does not add a side channel to broadcast when you are online or
typing. Your address book is read on the device to suggest whom to invite,
and never uploaded.

The full account of what leaves your device and to whom is on the
[Privacy](../privacy) page.

## Extensions and network

- **Plugins** is covered under [Plugins & commands](./plugins).
- **Protocols** connects and configures each network; see
  [Networks](./networks).
- **XMTP network** picks production or the developer network.
- **Inbox id** is your XMTP inbox identifier, for support and for other
  apps.
