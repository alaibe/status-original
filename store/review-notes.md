# App Review notes

Paste the section below into App Store Connect → App Review Information →
Notes.

---

## Paste this

Status Original is a non-custodial encrypted messenger. There is no sign-in and
no account on our servers, so there are no login credentials to give you. The
app creates a local key on first launch.

TO REVIEW THE APP

Open the app and tap "Create an account", then "Reveal recovery phrase" and
"I've written it down". The local Status room provides help and commands; real
messages require another XMTP, Nostr or Waku user.

WHY THE APP STARTS ALMOST EMPTY

Chains, market data, a dapp browser and similar features are plugins that ship
switched off. Settings → Plugins lists them; each says what it adds and what it
may reach. Turning one on takes effect immediately and adds its own
conversation to the chat list. Nothing makes a network request until enabled.

ABOUT THE WALLET FEATURES

The app is a self-custodial wallet: keys are generated on the device from a
recovery phrase and are never transmitted. We hold no customer funds, operate
no exchange, and take no fee on any transaction. Transactions are signed on
device and broadcast directly to public blockchain endpoints. There is no
in-app purchase of cryptocurrency and no fiat on-ramp.

Hardware wallet support (Ledger, Trezor, Keystone) is present in the UI. It
requires a physical device and cannot be exercised in the Simulator.

NO ACCOUNTS OR KEYS SHIP WITH THE APP

Optional integrations (Alchemy for token balances, KLIPY for GIF search, your
own blockchain endpoint) require an API key that the user supplies and that is
stored only on their device. Those features are inert until a key is entered,
which is why they appear to do nothing on a fresh install. Swaps and bridges
(/trade) are quoted by LI.FI's public API and need no key; an optional one only
raises the rate limit.

CONTACTS PERMISSION

Requested only when the user opens Contacts → Invite friends. The address book
is read on the device to suggest who to invite; it is never uploaded, and no
part of it leaves the device.

---

## What gets apps like this rejected

### Guideline 3.1.5(b), cryptocurrency wallets

Apple requires apps with wallet functionality to be published by an
organization, not an individual developer account. Check the enrolled account
type before building. This is a rejection you cannot argue your way out of, and
switching enrollment takes weeks.

### Guideline 3.1.1, in-app purchase

Nothing here sells anything, which is the safe side of this line. A paid tier
that unlocks wallet features would invite a much harder review.

### Guideline 5.1.1, data collection

The privacy answers in `privacy-labels.md` declare one thing: Performance Data
from `expo-observe`, not linked to the user. Everything else is "not
collected", and that has to stay true. Adding analytics or a crash reporter
that captures user content without updating those answers is a false
declaration.

### Export compliance

This app implements non-exempt encryption and `app.json` says so. See
`export-compliance.md` for what App Store Connect asks next; getting it wrong
is a legal question rather than a store one.

### Messaging verification

The automated release check drives independently keyed Nostr and Waku sessions
through deterministic relay and node boundaries. It does not prove public
infrastructure, XMTP native delivery or release-build networking. Before
submission, exchange a unique message and reply between two clean release
installations over every protocol the build claims.

### iPad

`app.json` sets `ios.supportsTablet: false`, so App Store Connect asks for
iPhone screenshots only and reviewers test on iPhone. Turning tablet support on
later means reviewing every layout at that size first.
