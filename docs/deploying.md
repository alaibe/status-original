# Deploying

What is already set up, and what only you can do.

## Done

### Brand

One source image, `assets/brand/status-logo-2018.png`, produces every store
asset via `npm run brand:build` (needs `brew install librsvg`). The first step,
`scripts/trace-brand-mark.js`, lifts the mark off the tile as a vector and
writes `assets/brand/mark.svg`, recording the plate colour, the tile's corner
radius and how far the mark reaches from the centre. The second,
`scripts/generate-brand-assets.js`, renders from that: the 1024 iOS icon in
light, dark and tinted variants, the three Android adaptive layers (the
foreground inset to the launcher's safe circle from the recorded reach), the
splash mark, a 96px Android notification icon, the favicon, the circular avatar
the Status room shows in the chat list, and the Play icon and feature graphic
in `store/play/`. It also writes the plate colour into the places `app.json`
repeats it. Keeping all of it generated is the point: change the source image,
run the script, and nothing is left behind. Both steps are deterministic (a
second run is byte-identical) and need no npm dependency; the PNG reader is
`scripts/lib/png.js`.

The plate colour is the logo's own, `#4A57AD`, and the UI's `brand` token in
`src/design/tokens.ts` is the same colour, with its soft, strong and dark-mode
companions derived from it. A test holds the token to the traced plate. A new
logo therefore means `npm run brand:build`, then the token, then
`npm run theme:build`, and the test says so if any of the three is skipped.

Screenshots come from `store/screenshots/capture.sh`.

### Expo modules build from source

SDK 57 links Expo modules as precompiled XCFrameworks by default. Two things
broke here. The debug slice of `expo-contacts` 57.0.5 was compiled against
Swift Testing with the rpaths of the machine that built it, so a debug build
aborted at launch with "Library not loaded: @rpath/Testing.framework/Testing"
before a line of JavaScript ran. With only that module moved to source, the app
then segfaulted in `ExpoModulesJSI` while creating its first native module
object: a precompiled `ExpoModulesCore` sitting on a source-built, patched
`ExpoModulesJSI` (see `patches/`). `expo-build-properties` therefore sets
`ios.usePrecompiledModules: false`, so every Expo module is compiled from the
same sources as the patches. Builds take longer, and they run. Try removing the
setting when a later SDK ships clean artifacts.

### Permission strings

All five are specific, which is what Apple's reviewers check. The microphone
one was the blocker: `expo-audio` was configured bare, so prebuild emitted
"Allow $(PRODUCT_NAME) to access your microphone", which gets rejected.

### Privacy manifest

`ios.privacyManifests` declares the three required-reason APIs the dependencies
touch (UserDefaults through AsyncStorage, file timestamps, disk space), one
collected data type, Performance Data, for `expo-observe` (see
`store/privacy-labels.md`), and `NSPrivacyTracking: false`. There is no
analytics SDK, no crash reporter and no account.

### Export compliance

`ITSAppUsesNonExemptEncryption` is `true` in `app.json`. This is an end-to-end
encrypted messenger, so the usual reflex of setting it to `false` to stop Apple
asking would be a false declaration. App Store Connect will ask for a
self-classification report or a CCATS on the first upload;
`store/export-compliance.md` explains both.

### Android permissions

Declared explicitly, and the ones the image picker and audio pull in
transitively (`READ_MEDIA_*`, `*_EXTERNAL_STORAGE`) are blocked. Nothing here
reads them, and every permission in the manifest is one more thing the store
listing has to justify.

### `eas.json`

Three profiles: `development` (dev client, simulator, XMTP dev network),
`preview` (internal APK), `production` (app bundle, `autoIncrement`). Version
numbers come from EAS (`appVersionSource: remote`) so two machines cannot mint
the same build number.

### `npx expo-doctor`: 21/21

`expo prebuild` verified: usage strings land in `Info.plist`, the 1024 icon has
its alpha stripped (App Store Connect rejects one that still has it), and
`PrivacyInfo.xcprivacy` is generated.

## What only you can do

Link the EAS project: `eas login`, then `eas init`. That writes
`extra.eas.projectId` and `owner` into `app.json`. Nothing can build until it
exists.

Fill in the submit config. `eas.json` has two placeholders, `ascAppId` (App
Store Connect → App Information → Apple ID) and `appleTeamId`. For Play, drop a
service-account JSON at `secrets/play-service-account.json`; `/secrets` is
gitignored.

File the export-compliance paperwork when App Store Connect asks. Most
messengers using standard cryptography qualify for the 740.17(b)(1) exemption
and still owe an annual self-classification report. Decide it with someone who
knows your jurisdiction.

Reserve the bundle id, `com.statusoriginal.app`, on both stores.

Enroll as an organization. Guideline 3.1.5(b) requires it for apps with wallet
functionality; `store/review-notes.md` has the details.

## Sequence

```sh
eas login && eas init
eas build --profile development --platform ios     # dev client, simulator
eas build --profile preview   --platform all       # share with testers
eas build --profile production --platform all
eas submit --profile production --platform ios
```
