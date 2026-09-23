# Settings

<div class="phones">
  <figure><img src="/screenshots/settings.png" alt="The Settings tab"><figcaption>Settings</figcaption></figure>
  <figure><img src="/screenshots/privacy.png" alt="Settings → Privacy: read receipts, link previews, and what is never collected"><figcaption>Privacy: two switches, and a list of what is not collected</figcaption></figure>
</div>

## Account

- **Accounts** lists every account on this device, and is where you add one or
  switch.
- **My QR code** shows your addresses as a code someone can scan to start a
  chat.
- **Recovery phrase** shows the words again and holds the security switches:
  *Require Face ID* to open the app, and *Also protect keys*, which seals the
  phrase in the keychain so nothing reads it or signs with it without Face ID
  first.
- **Erase this account** is covered under
  [Your account](./account#erase-an-account).

## Preferences

- **Appearance** sets light, dark or system, and the chat wallpaper.
- **Privacy** is below.
- **Trades** takes a LI.FI key for swaps and bridges. They work without one;
  the key only raises how often you can ask for a quote. See
  [Wallet](./wallet#swap-and-bridge).
- **GIFs** takes a KLIPY key for GIF search. Optional, under the same rule: no
  key ships with the app, and yours stays on this device.
- **Devices** lists the phones and computers signed in to your XMTP inbox, and
  revokes one you no longer have.

## Privacy

Three switches:

- **Send read receipts** is off. The other person does not see when you open
  their messages, and you do not see when they open yours.
- **Send typing indicators** is off. When it is on, people on Telegram and
  Matrix see that you are typing. It sends a signal every time you touch the
  keyboard.
- **Show link previews** is on. A link becomes a card fetched by this device
  straight from the linked site, so the site learns your address as soon as the
  message arrives, before you tap anything. Turn it off to keep that to
  yourself.
  [Messages](./messages#links-and-everything-tappable) has the detail.

Below the switches the screen lists what the app does *not* do. It adds no
last seen of its own: XMTP, Nostr and Waku carry no presence, Telegram shows
when you were last online the way the Telegram apps do, and Matrix does when
your homeserver shares presence. It uploads no
contacts: your address book is read on the device to suggest who to invite, and
never sent anywhere.

The full account of what leaves your device, and to whom, is on the
[Privacy](../privacy) page.

## Extensions and network

- **Plugins** is covered under [Plugins & commands](./plugins).
- **Protocols** connects and configures each network; see
  [Networks](./networks).
- **XMTP network** picks production or the developer network.
- **Inbox id** is your XMTP inbox identifier, useful for support and for other
  apps.
