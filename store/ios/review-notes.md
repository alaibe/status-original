# App Review notes

Goes into App Store Connect → App Review Information → Notes.

Status Original is a non-custodial encrypted messenger. There is no sign-in and
no account on our servers, so there are no login credentials to provide. The app
creates a local key on first launch.

TO REVIEW THE APP

Open the app and tap "Create an account", then "Reveal recovery phrase" and
"I've written it down". The local Status room provides help and commands and
works without a second party. Sending a message to someone requires another
XMTP, Nostr or Waku user.

PLUGINS

Chains, market data, a dapp browser and bots are plugins that ship switched off.
Settings → Plugins lists them, and each states what it adds and what it may
reach. Turning one on takes effect immediately and adds its own conversation to
the chat list.

WALLET

The app is a self-custodial wallet. Keys are generated on the device from a
recovery phrase and are never transmitted. We hold no customer funds, operate no
exchange, and take no fee on any transaction. Transactions are signed on the
device and broadcast directly to public blockchain endpoints. There is no in-app
purchase of cryptocurrency and no fiat on-ramp.

Hardware wallet support (Ledger, Trezor, Keystone) requires the physical device.

API KEYS

The app ships with none. GIF search (KLIPY), a custom blockchain endpoint and
Telegram's API credentials each use a key the user supplies, stored on their
device. Swaps and bridges (/trade) are quoted by LI.FI's public API and need no
key; an optional one raises the rate limit.

CONTACTS PERMISSION

Requested only when the user opens Contacts → Invite friends. The address book
is read on the device to suggest who to invite and never leaves it.
