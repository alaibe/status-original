# Export compliance

Apple asks, on every build: "Does your app use encryption?" For most apps the
answer is a quick no. For this one it is yes, and the wrong answer here is a
legal problem rather than a review note. Nothing below is legal advice; the
point is to put the facts in front of whoever gives it.

## What this app actually contains

| Encryption | Where | Exempt? |
|---|---|---|
| MLS group messaging (XMTP) | `@xmtp/react-native-sdk` | No: confidentiality of user content |
| NIP-44 / NIP-17 (Nostr) | `src/protocols/nostr` | No: same |
| Encrypted Waku payloads | `src/protocols/waku` | No: same |
| SQLCipher local databases | `expo-sqlite`, `@xmtp/react-native-sdk` | No: confidentiality of stored user content |
| secp256k1, ed25519 signing | `@noble/curves`, `@scure/*` | Yes: authentication and signing are exempt |
| Keychain and Face ID | iOS platform | Yes: provided by the platform |

The first three put this outside the "only exempt encryption" answer.
End-to-end encrypted messaging is the app's purpose.

## What is set

`app.json`, under `expo.ios.infoPlist`:

```json
"ITSAppUsesNonExemptEncryption": true
```

`false`, or leaving the key out and answering "no" in App Store Connect, would
declare that the app uses only exempt encryption. It does not.

## What follows from `true`

App Store Connect asks, on the first upload, for one of:

- a CCATS classification from the US Bureau of Industry and Security, or
- a self-classification report under License Exception ENC (5D002),
  submitted annually to BIS and the NSA, which yields an ERN to enter.

Mass-market encryption software of this kind is normally eligible for
self-classification, the lighter path. Eligibility depends on who publishes and
from where, which is why a person has to answer this and a config file cannot.
The report is a form, not a review: it lists the product, the encryption it
uses (the table above is the content) and the publisher, and it is filed once
a year.

France also requires a declaration for apps distributed there that use
cryptography. App Store Connect asks about this separately, and the answer
for this app is yes.

