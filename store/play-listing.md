# Google Play listing

Play has no equivalent of EAS Metadata, so this is copy to paste into the Play
Console rather than a file to push. The limits are Play's own and differ from
Apple's; the short description in particular is 80 characters, not 30.

## Store listing

App name (30):

```
Status Original
```

Short description (80), shown in search results and above the fold:

```
Encrypted chat where the account is a key you hold. No phone number, no email.
```

Full description (4000):

```
A messenger with no company in the middle.

Your account is a twelve-word recovery phrase held on your device. There is no sign-up, no phone number, no email address, and no account on a server that could be seized, sold or breached.

WHAT IT DOES
• End-to-end encrypted one-to-one and group chats over XMTP, Nostr or Waku. You choose per conversation, and the app says what each one protects.
• Replies, reactions, photos, files and voice notes
• An on-device Status room for help and plugin commands
• The same recovery phrase is an Ethereum, Bitcoin and Solana wallet: check a balance, send, ask someone to pay you, or split a bill inside the conversation where it came up
• Connect a Ledger, Trezor or Keystone and the key never touches this phone

STARTS EMPTY, BY DESIGN
A new install is a messenger and nothing else. The wallet, market alerts, the dapp browser and the rest are plugins that ship switched off. Each one says what it adds and what it is allowed to reach before you turn it on. Nothing runs or appears in your chat list until you ask for it.

NO ACCOUNTS, NO KEYS
The app ships with no API keys of its own. Where a feature needs one (token balances, GIF search, your own blockchain endpoint) you supply it, and it stays on your device, per account. Your address book is read on the device to suggest who to invite and is never uploaded. The only thing the developer receives is anonymous performance data: how long the app took to start, and the host of the slowest request while it did.

WHAT THIS COSTS YOU
Nobody can reset your account. Write the twelve words down and keep them offline. If you lose them, they are gone. That is what having no company in the middle means, and the app says so plainly.
```

Category: Communication. Tags: messaging, privacy.

## Graphics Play requires that Apple does not

| Asset | Size | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `store/play/icon.png`, from `npm run brand:build` |
| Feature graphic | 1024×500 PNG or JPEG, no alpha | `store/play/feature-graphic.png`, from `npm run brand:build` |
| Phone screenshots | 2 to 8, min 320px, max 3840px, 16:9 or 9:16 | not captured; Android has not been built yet |
| Tablet screenshots | required if you claim tablet support | not claimed; `supportsTablet` is off on iOS and nothing here targets tablets |

The feature graphic is the mark centred on the plate colour, with no text,
which Play discourages on it anyway. Both files regenerate with the rest of the
brand assets, so a new logo cannot leave them behind.

## Data safety

Play's form is stricter than Apple's: it asks about sharing and collection
separately, and it asks whether data is encrypted in transit and whether users
can request deletion.

Data collected: app performance data (startup and navigation timings, plus the
host of the slowest request during launch), via `expo-observe`, not linked to
a user. See `privacy-labels.md`; the same declaration applies to both stores.
Data shared: none. Encrypted in transit: yes. Deletion: the app holds no
account, so there is nothing to request deletion of; signing out erases the
local database and keys. Say this plainly in the form's free text rather than
leaving it blank.

Location deserves a note. `react-native-ble-plx` requires location permission
to scan for Bluetooth devices on Android 11 and below. The manifest scopes it
to `maxSdkVersion="30"` and marks the Android 12+ scan permission
`neverForLocation`, so the app never uses Bluetooth to derive location. If the
form asks about location, that is the answer, and it is worth checking the
generated manifest still says so after any dependency bump.

## Content rating

Play's questionnaire is answered per app by IARC. This is a communication app
with user-to-user messaging and no moderation, which typically yields a teen
rating rather than everyone. Users can interact: yes. Users can share content:
yes, directly with each other. Users can share their location: no. Digital
purchases: no.

## Policy risks specific to this app

Financial products. Play's policy covers crypto exchanges and wallets. A
self-custodial wallet that neither holds funds nor sells anything is generally
permitted, but the declaration matters: do not describe the app as an exchange
or imply it facilitates buying.

Blockchain-based content. Play requires apps with blockchain features to declare
them. There are no NFTs or tokenised in-app content here, which keeps this
simple, but the declaration still has to be made.

Target API level. Play enforces a minimum target API for new submissions and
raises it annually. The prebuild uses the Expo SDK 57 default; check it against
Play's current requirement before building, because this one is a hard block on
upload.
