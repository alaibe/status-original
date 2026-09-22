# App Privacy answers

What to enter in App Store Connect → App Privacy, and in Play's Data safety
form. Each answer is written so it can be checked against the code rather than
taken on trust, because a privacy label is a legal declaration.

## The short answer

One data type, collected: Diagnostics → Performance Data. Not linked to the
user, not used for tracking, purpose App Functionality. Everything else is *not
collected*.

The app has no backend, no server-side account, no analytics SDK and no
identifier tied to a person. Nothing the user types, holds or reads reaches the
developer.

In App Store Connect: answer **Yes** to "Do you or your third-party partners
collect data from this app?", tick only **Performance Data**, and answer the
follow-ups as above. `app.json` declares the same thing under
`ios.privacyManifests.NSPrivacyCollectedDataTypes`, so the manifest and the
label agree.

## Why Performance Data

`expo-observe` is installed and active. It sends startup and navigation timings
to EAS, and while the app launches it watches network requests and attaches the
host of the slowest one to what it uploads.

For this app those hosts are XMTP and Nostr relays, Telegram or a Matrix
homeserver if the user signed in, and the user's own blockchain endpoint if they
set one. That is metadata about which services a device talks to, leaving the
device, and `expo-observe` has no switch to turn it off.

The decision was to keep it and say so. `PRIVACY.md` names the data and the
request-host detail explicitly. If this ever changes, either remove the package
and answer *Data Not Collected*, or point it at a collector you run
(`extra.eas.observe.endpointUrl`) and keep the declaration accurate.

## The privacy policy URL

`ios/store.config.json` points at `PRIVACY.md` in the repository, which is also
published at the docs site. Apple requires the URL to resolve, and the policy
has to say the unusual thing: that the developer receives only the performance
data above, and that the user's real counterparties are relay operators and
blockchain endpoints the user chose.

## What the app does on the device, for the policy text

None of this is "collection" in Apple's sense, since none of it reaches the
developer. The policy describes it anyway, because it is what a careful reader
will want to know.

| What | Where it goes | Code |
| --- | --- | --- |
| Messages | End-to-end encrypted to the network the conversation is on (XMTP, Nostr, Waku). Relays see ciphertext and routing metadata. | `src/protocols/*/adapter.ts` |
| Telegram | Only if the user signs in. Plaintext to Telegram's servers, as with the official client; the phone number is the sign-in. The user supplies their own API ID and hash. | `src/protocols/telegram/adapter.ts` |
| Matrix | Only if the user signs in. To the homeserver the user names. Encrypted rooms are end-to-end encrypted; the homeserver sees metadata; a bridge it runs sees plaintext. The session token stays in the keychain. | `src/protocols/matrix/adapter.ts` |
| Recovery phrase and keys | iOS Keychain, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, optionally sealed behind Face ID. Never transmitted. | `src/storage/vault.ts`, `src/storage/secure-store.ts` |
| Message history | Per-account SQLCipher databases, erased with the account. Telegram history lives in TDLib's own encrypted database and Matrix history in matrix-rust-sdk's, each keyed from the keychain and erased the same way. | `src/storage/database.ts`, `src/protocols/*/descriptor.ts` |
| Address book | Read on the device to suggest invitations. Never uploaded. | `src/app/invite.tsx`, `src/features/contacts/device-contacts.ts` |
| Blockchain reads and sends | Direct from the device to a public endpoint, or the user's own if set. That endpoint sees the addresses looked at. Stated in the app under `/rpc`. | `src/lib/evm/chains.ts`, `src/plugins/wallet/{bitcoin,solana}` |
| Prices | Public market endpoint, no account, no identifier. | `src/plugins/markets/api.ts` |
| Token balances | From the same public endpoint as everything else: EVM by calling each contract on a bundled list, Solana by asking the node what the address holds. No third party, no key. | `src/lib/evm/tokens.ts`, `src/plugins/wallet/solana/tokens.ts` |
| Swaps and bridges | LI.FI quotes and routes `/trade`, seeing the address, tokens and amount asked about. Works without a key; a user-supplied key only raises the rate limit. | `src/lib/lifi.ts`, `src/plugins/wallet/trade.ts` |
| GIF search | KLIPY, only if the user supplies their own key. | `src/features/chat/attachments/gifs.ts` |
| Link previews | The page behind a link is fetched straight from the linked site, which sees the device's network address. Switch under Settings → Privacy; results cached on the device for a week. | `src/core/messaging/link-preview.ts`, `link-preview-cache.ts` |
| Push notifications | Local notifications only. No push token is registered with anyone. | `src/core/app/use-notifications.ts` |
| App updates | Each launch asks `u.expo.dev` for a newer JavaScript bundle for this channel and native fingerprint. Carries no account or content; Expo sees the network address. Yields a per-version device count on the EAS dashboard. | `app.json` → `expo.updates` |

## Permission strings

Already in `app.json`, and worth re-reading before submission because Apple
rejects vague ones. Each names both the reason and the limit. Contacts, for
instance: *"Status Original reads your contacts on this device only, to suggest
who to invite. They are never uploaded."*

Covered: contacts, microphone, camera, photos, Face ID, Bluetooth.

## Play's Data safety form

Stricter than Apple's: it asks about collection and sharing separately, and
about encryption in transit and deletion.

- Collected: app performance data (startup and navigation timings, plus the
  host of the slowest request during launch), via `expo-observe`, not linked to
  a user.
- Shared: none.
- Encrypted in transit: yes.
- Deletion: the app holds no account, so there is nothing to request
  deletion of. Erasing the account removes the local database and keys. Say that
  in the free text rather than leaving it blank.

Location deserves a note. `react-native-ble-plx` requires location
permission to scan for Bluetooth devices on Android 11 and below. The manifest
scopes it to `maxSdkVersion="30"` and marks the Android 12+ scan permission
`neverForLocation`, so the app never uses Bluetooth to derive location. If the
form asks, that is the answer, and it is worth re-checking the generated
manifest still says so after any dependency bump.
