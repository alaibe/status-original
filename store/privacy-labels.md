# App Privacy answers

What to enter in App Store Connect → App Privacy. Each answer below is written
so you can check it against the code rather than take it on trust, because a
privacy label is a legal declaration.

## The short answer

One data type, collected: Diagnostics → Performance Data, not linked to
the user, not used for tracking, purpose App Functionality. Everything else is
"not collected". The app has no backend, no account on a server, no analytics
SDK and no identifier tied to a person; nothing the user types, holds or reads
reaches the developer.

In App Store Connect, answer Yes to "Do you or your third-party partners
collect data from this app?", tick only Performance Data, and answer the
follow-ups as above. `app.json` declares the same thing in
`ios.privacyManifests.NSPrivacyCollectedDataTypes`, so the manifest and the
label agree.

## Why Performance Data

`expo-observe` is installed and active. It sends startup and navigation
timings to EAS, and while the app launches it watches network requests and
attaches the host of the slowest one to what it uploads. For this app the
hosts are XMTP and Nostr relays, Telegram if the user signed in, and, if the
user set one, their own blockchain endpoint. That is metadata about which services a device talks to, leaving
the device, and `expo-observe@57.0.21` has no switch to turn it off.

The decision was to keep it and say so. `PRIVACY.md` at the repository root
names the data and the request-host detail. If that ever changes, either
remove the package and answer "Data Not Collected", or point it at a collector
you run (`extra.eas.observe.endpointUrl`) and keep the declaration.

## The privacy policy URL

`store.config.json` points at `PRIVACY.md` in the repository. Apple requires
the URL to resolve, and the policy has to say the unusual thing: that the
developer receives only the performance data above, and that the user's
counterparties are relay operators and blockchain endpoints the user chooses.

## What the app does on the device, for the policy text

None of this is "collection" in Apple's sense, since none of it reaches the
developer, but the policy should describe it because it is what a careful
reader will want to know.

| What | Where it goes | Code |
|---|---|---|
| Messages | End-to-end encrypted to the relay network the conversation is on (XMTP, Nostr or Waku). Relays see ciphertext and routing metadata. | `src/protocols/*/adapter.ts` |
| Telegram | Only if the user signs in. Plaintext to Telegram's servers, as with the official client; the phone number is the sign-in. The user supplies their own API ID and hash. | `src/protocols/telegram/adapter.ts` |
| Recovery phrase and keys | iOS Keychain, optionally sealed behind Face ID. Never transmitted. | `src/storage/vault.ts` |
| Message history | Per-account SQLCipher databases, erased with the account. Telegram history lives in TDLib's own encrypted database, keyed from the keychain and erased the same way. | `src/storage/database.ts`, `src/protocols/xmtp/adapter.ts`, `src/protocols/telegram/descriptor.ts` |
| Address book | Read on device to suggest invitations. Never uploaded. | `src/app/invite.tsx` |
| Blockchain reads and sends | Direct from the device to a public endpoint, or the user's own if set. That endpoint sees the addresses looked at. Said in the app under `/rpc`. | `src/lib/evm/chains.ts`, `src/plugins/wallet/{bitcoin,solana}` |
| Prices | Public market endpoint, no account, no identifier. | `src/plugins/markets/api.ts` |
| Token balances | Alchemy, only if the user supplies their own key. | `src/lib/evm/tokens.ts` |
| GIF search | KLIPY, only if the user supplies their own key. | `src/features/chat/attachments/gifs.ts` |
| Link previews | The page behind a link is fetched straight from the linked site, which sees the device's network address. Off switch under Settings → Privacy; results cached on the device for a week. | `src/core/messaging/link-preview.ts`, `link-preview-cache.ts` |
| Push notifications | Local notifications only; no push token is registered with a server. | `src/core/app/use-notifications.ts` |

## Permission strings

Already in `app.json` and worth re-reading before submission, because Apple
rejects vague ones. Current text names both the reason and the limit, e.g. contacts:
"Status Original reads your contacts on this device only, to suggest who to
invite. They are never uploaded."

Covered: contacts, microphone, camera, photos, Face ID, Bluetooth.
