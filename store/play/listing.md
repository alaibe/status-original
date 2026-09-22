# Google Play listing

Play has no equivalent of EAS Metadata, so this is copy to paste into the Play
Console rather than a file to push. The limits are Play's own and differ from
Apple's; the short description in particular is 80 characters, not 30.

Play requires at least two phone screenshots, which have to come from an
Android build. Everything else below is ready to paste.

## Store listing

**App name** (30):

```
Status Original
```

**Short description** (80), shown in search results and above the fold:

```
Encrypted chat where the account is a key you hold. No phone number, no email.
```

**Full description** (4000):

```
A messenger with no company in the middle.

Your account is a twelve-word recovery phrase held on your device. There is no sign-up, no phone number, no email address, and no account on a server that could be seized, sold or breached.

WHAT IT DOES
• End-to-end encrypted one-to-one and group chats over XMTP, Nostr or Waku. You choose per conversation, and the app says what each network protects.
• Your own Telegram and Matrix accounts in the same inbox, signed in with your credentials. A Matrix server running a bridge brings WhatsApp, Signal, Slack or iMessage along with it.
• Replies, reactions, forwarding, photos, files, GIFs and voice notes.
• An on-device Status room for help and plugin commands.
• The same recovery phrase is an Ethereum, Bitcoin and Solana wallet: check a balance, send, swap, ask someone to pay you, or split a bill inside the conversation where it came up.
• Connect a Ledger, Trezor or Keystone and the key never touches this phone.

STARTS EMPTY, BY DESIGN
A new install is a messenger and nothing else. The wallet, market alerts, the dapp browser and the rest are plugins that ship switched off. Each one says what it adds and what it is allowed to reach before you turn it on. Nothing runs or appears in your chat list until you ask for it.

NO ACCOUNTS, NO KEYS
The app ships with no API keys of its own. Where a feature needs one (GIF search, your own blockchain endpoint, Telegram's API credentials) you supply it, and it stays on your device, per account. Your address book is read on the device to suggest who to invite and is never uploaded. The developer receives two anonymous things: how long the app took to start with the host of the slowest request while it did, and a count of how many devices run each version.

WHAT THIS COSTS YOU
Nobody can reset your account. Write the twelve words down and keep them offline. If you lose them, they are gone. That is what having no company in the middle means, and the app says so plainly.
```

Category: Communication. Tags: messaging, privacy.

## Graphics Play requires that Apple does not

| Asset | Size | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | `store/play/icon.png`, from `npm run brand:build` |
| Feature graphic | 1024×500 PNG or JPEG, no alpha | `store/play/feature-graphic.png`, from `npm run brand:build` |
| Phone screenshots | 2 to 8, min 320px, max 3840px, 16:9 or 9:16 | capture from an Android build |
| Tablet screenshots | required if you claim tablet support | not claimed; `supportsTablet` is off and nothing here targets tablets |

The feature graphic is the mark centred on the plate colour, with no text, which
Play discourages on it anyway. Both files regenerate with the rest of the brand
assets, so a new logo cannot leave them behind.

## Data safety

`privacy-labels.md` holds the answers, including the Bluetooth-and-location
note that is specific to Android. The same declaration covers both stores.

## Content rating

Play's questionnaire is answered per app by IARC. This is a communication app
with user-to-user messaging and no moderation, which typically yields a teen
rating rather than everyone.

- Users can interact: **yes**
- Users can share content: **yes**, directly with each other
- Users can share their location: **no**
- Digital purchases: **no**

## Declarations Play requires

Financial features: a self-custodial wallet that holds no funds and sells
nothing. Do not describe the app as an exchange or imply it facilitates buying.

Blockchain features: yes. No NFTs and no tokenised in-app content.

Target API level: meet Play's current minimum, which rises annually. The
prebuild uses the Expo SDK 57 default; check it before building, because it is
a hard block on upload.
