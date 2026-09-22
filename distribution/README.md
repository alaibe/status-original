# Shipping

How a release reaches people, and the artifacts the stores ask for along the
way. The files here exist so you can review each answer before pasting it into
a form.

| File | Goes into |
| --- | --- |
| `ios/store.config.json` | EAS Metadata → App Store Connect listing (`eas metadata:push`) |
| `ios/review-notes.md` | App Review Information → Notes |
| `privacy-labels.md` | App Privacy questionnaire (both stores) |
| `ios/export-compliance.md` | the encryption question asked on every upload |
| `play/listing.md` | Play Console listing, Data safety and content rating |
| `ios/screenshots/6.9/` | App Store Connect → Media Manager, iPhone 6.9" |
| `ios/capture.yaml` | the Maestro flow those come from, run by `scripts/capture-screenshots.sh store` |
| `play/icon.png`, `play/feature-graphic.png` | Play listing graphics, from `npm run brand:build` |

The six screenshots are `01-welcome`, `02-chats`, `03-conversation`, `04-note`,
`05-message-actions` and `06-plugins`. Regenerate them with
`./scripts/capture-screenshots.sh store` after any change to onboarding, the
chat list, Settings or `app.json`, and before every submission. The same script
takes `docs` to refresh the user guide's screenshots from its own flow.

Text limits and the rest of the pre-flight checks live in
`.claude/skills/store-artifacts/SKILL.md`, which is written as a runbook and
reads fine as one.

## Before you submit

Enroll as an organization. Guideline 3.1.5(b) requires it for apps with
wallet functionality. Check the enrollment type before building; changing it
takes weeks and there is no arguing your way past it.

Answer export compliance honestly. `app.json` says `true`, because the app
ships non-exempt encryption. App Store Connect will ask for a
self-classification report or a CCATS on the first upload. See
`ios/export-compliance.md`.

Keep the privacy answers true. Two things leave the device on their own:
`expo-observe` performance data, including the host of the slowest request
during launch, and the update check, which yields a per-version device count.
Both are described in `privacy-labels.md` and `PRIVACY.md`, and the privacy
manifest declares the first. Change all of them together or none.

Fill in the reviewer contact yourself. The one in `ios/store.config.json` is a
placeholder on purpose: it is personal information and this repository is
public. Enter it in App Store Connect.

Capture Android screenshots. Play requires at least two phone screenshots,
and they have to come from an Android build. `play/listing.md` has the rest of
what Play asks for that Apple does not.

Keep other companies' names out of the keywords. Telegram and Matrix are real
integrations and the description says so, which is descriptive use and fine.
A trademark in the keyword field is not, and Apple rejects for it.

Point the disclaimer somewhere people can read it. App Store Connect offers
Apple's standard EULA by default; `DISCLAIMER.md` is published at
`/disclaimer` on the docs site and says what this app in particular does not
take responsibility for.

## One-off builds

For something that is not a release:

```sh
eas build --profile development --platform ios     # dev client, simulator
eas build --profile preview   --platform all       # share with testers
npm run desktop:build                              # an unsigned local .app and .dmg
```

Four things are not in the repository and have to be filled in once: the EAS
project link (`eas login && eas init`), `ascAppId` and `appleTeamId` in
`eas.json`, a Play service account at `secrets/play-service-account.json`
(gitignored), and the export-compliance filing when App Store Connect asks.

Already configured and verified with `npx expo-doctor` (21/21): the five
permission strings, which name both the reason and the limit; the privacy
manifest, declaring the three required-reason APIs and Performance Data;
`ITSAppUsesNonExemptEncryption: true`; Android permissions, with the transitive
media and storage ones blocked; and EAS profiles with `appVersionSource:
remote` so two machines cannot mint the same build number.

Android additionally needs phone screenshots, a target API level meeting Play's
current minimum, and a JDK between 17 and 21 for Gradle
(`./scripts/setup.sh --android` checks the toolchain). Telegram needs a second
native backend there: `react-native-tdlib`'s Android side does not expose the
raw `td_json_client` calls `src/protocols/telegram/td-client.ts` drives.

## Releasing

Push a tag:

```sh
git tag v1.0.0 && git push github v1.0.0
```

`.github/workflows/release.yml` opens one draft release, fills it from every
platform in parallel, and publishes it once each job has succeeded. Everything
it needs to sign comes from repository secrets, so no credential lives on a
laptop. Run it from the Actions tab instead of pushing a tag to leave the
result as a draft.

| Job | Runner | Produces |
| --- | --- | --- |
| macOS | `macos-15` | signed, notarized universal `.dmg` and `.app.tar.gz` |
| Linux | `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage` |
| Windows | `windows-latest` | `.msi` and an NSIS `.exe` |
| Android | `ubuntu-latest` | signed `.apk`, built by EAS |
| iOS | `ubuntu-latest` | TestFlight, through EAS Submit |

The desktop jobs are [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action),
which also writes and merges `latest.json` across the three platforms, so
installed copies update themselves. The mobile job is
[`expo/expo-github-action`](https://github.com/expo/expo-github-action); EAS
builds on its own infrastructure, which is why one Linux runner can produce an
iOS build.

Before any of it runs, a guard checks that the tag, `app.json`,
`package.json`, `tauri.conf.json` and `Cargo.toml` all carry the same version.
A tag that disagrees with a manifest ships a build whose in-app version is not
the one people downloaded.

Notarization is macOS-only by nature; Linux and Windows bundles are unsigned,
and signing those is a separate certificate on each platform that is not wired
up.

### The secrets

| Secret | For |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of a Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you exported it with |
| `KEYCHAIN_PASSWORD` | anything; names the temporary keychain the action makes |
| `APPLE_SIGNING_IDENTITY` | the identity inside that certificate |
| `APPLE_ID` | your Apple account, for notarization |
| `APPLE_PASSWORD` | an app-specific password, not your Apple password |
| `APPLE_TEAM_ID` | the team the certificate belongs to |
| `TAURI_SIGNING_PRIVATE_KEY` | signs updates, on every platform |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| `EXPO_TOKEN` | lets the Android and iOS jobs run at all |

Base64 the certificate with `base64 -i cert.p12 | pbcopy`.

Without the notarization three the DMG is signed but Gatekeeper still warns on
first open. Without `EXPO_TOKEN` the mobile job is skipped rather than failing.
Linux and Windows bundles ship unsigned. Signing them takes a certificate per
platform, which is worth adding once either has users.

The update signing keypair is separate from anything Apple issues, and you make
it once:

```sh
npx tauri signer generate -w ~/.tauri/status-original.key
```

The public key goes in `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey` and is committed; it is empty until you do this, and
the updater cannot verify anything without it. The private key is the secret.
Lose it and installed copies can never be updated again, because they accept
only what it signed.

### Android signing, across two channels

Play re-signs what you upload with the app signing key it holds, while the APK
on a GitHub Release carries whatever key EAS used. Two different signatures
means a person cannot upgrade from one channel to the other without
uninstalling first. To keep a single upgradeable install, the same app signing
key has to be on both sides: upload EAS's keystore as the Play app signing key
when you first enrol. Decide that before the first Play upload, because the key
cannot be changed afterwards.

## The Mac App Store

A separate build from the DMG, because an App Store app is sandboxed and may
not update itself.

`src-tauri/tauri.appstore.conf.json` sandboxes the app against
`src-tauri/Entitlements.plist` and drops the updater capability, and building
with `--no-default-features` leaves the updater out of the binary, because an
App Store app may not update itself. The entitlements are the part to watch:
USB HID for a Ledger, the address book for invitations, user-selected files for
attachments, and network client for everything else.

You supply four things from the Apple Developer account: a Mac App
Distribution certificate, a Mac Installer Distribution certificate, a
provisioning profile saved at `src-tauri/embedded.provisionprofile`
(gitignored), and the real team id in place of `TEAMID` in
`Entitlements.plist`. Organization enrolment under guideline 3.1.5(b) is the
long pole, so start it early. Then:

```sh
./scripts/fetch-tdlib.sh
npx tauri build --bundles app --target universal-apple-darwin \
  --config src-tauri/tauri.appstore.conf.json -- --no-default-features

xcrun productbuild --sign "$APPLE_INSTALLER_IDENTITY" \
  --component "src-tauri/target/universal-apple-darwin/release/bundle/macos/Status Original.app" \
  /Applications "Status Original.pkg"

xcrun altool --upload-app --type macos --file "Status Original.pkg" \
  --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
```

Tauri produces the `.app` and `productbuild` makes the `.pkg`; there is no
Tauri bundler target for it. Three commands, so this becomes a job in the
release workflow once you have run it once by hand.

## Updates after release

Desktop and mobile update by different means, and only one of them is automatic.

**Desktop** replaces the whole app. The updater reads `latest.json` from the
newest release, checks the signature against `plugins.updater.pubkey`, and
swaps the bundle. It covers macOS, Windows and AppImage; `.deb` and `.rpm` are
the package manager's business, so those users update through it or download
again.

**Mobile** ships JavaScript and assets only, never native code:

```sh
eas update --channel production --message "what changed"
```

`runtimeVersion` fingerprints the native project, and an update is served only
to builds whose fingerprint matches. So when a change touches native code there
is no update to publish, only a new build and a store submission. Publishing
otherwise reaches everyone on the channel, which `SECURITY.md` and `PRIVACY.md`
cover.

## TDLib, and which Linux

`scripts/fetch-tdlib.sh` picks the right library for whatever it runs on.
macOS builds one from Swiftgram's Apple xcframework, exporting only the five
`td_json_client_*` symbols. Linux and Windows download the same TDLib 1.8.67
already built, from the `prebuilt-tdlib` npm packages, and
`tauri.linux.conf.json` and `tauri.windows.conf.json` bundle it as a resource
that `src-tauri/src/tdlib.rs` resolves through Tauri's own resource directory.

Those prebuilt libraries carry OpenSSL and zlib statically but export their
symbols, which the macOS one does not. `Library::new` must therefore stay on
`libloading`'s default `RTLD_LOCAL`, or TDLib's OpenSSL could interpose on the
one SQLCipher uses. Windows DLLs export explicitly, so the question does not
arise there.

Which Linux matters. The `.deb`, `.rpm` and AppImage are built on
`ubuntu-22.04`, so they want glibc 2.35 or newer, and the script takes the
glibc build to match. Alpine and anything else on musl would need the musl
library and a musl-built bundle, which is not produced. Flatpak or Snap would
sidestep the glibc floor by shipping their own runtime; neither is wired up.

Architecture follows the runner. The script reads `uname -m`, so an arm64 Linux
runner would take the arm64 library, but no arm64 Linux job exists yet.
`prebuilt-tdlib` publishes Windows for x64 only, so Windows on ARM would run
without Telegram and with everything else intact.

That last case is the general one: the library is opened at runtime, and when
it is absent `tdlib.rs` reports "TDLib is not part of this build" and nothing
else in the app is affected.
