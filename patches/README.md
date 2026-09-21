# Dependency patches

Applied automatically by `patch-package` via the `postinstall` script. All of
them work around upstream bugs, and three of them the same one: Swift 6.2.4
(Xcode 26.3) is stricter than the Expo SDK 57 sources expected.

`expo-build-properties` sets `ios.usePrecompiledModules: false`, so these
sources are what actually ships. With the precompiled XCFrameworks a debug
build does not get as far as JavaScript: `docs/deploying.md` has the crash
reports.

Delete a patch as soon as its upstream fix lands. `patch-package` fails loudly
if a patch no longer applies, so a version bump will tell you.

Every patch below was checked on 2026-09-20 by reverting it in `node_modules`
and compiling the pod it targets with Xcode 26.3: each error reappears without
its patch and disappears with it. The newer upstream versions named in each
section were installed in a throwaway checkout and compiled the same way.

---

## `expo-modules-jsi+57.0.7.patch`

Symptom: iOS build fails with:

```
RuntimeScheduler.h:53:26: error: 'RuntimeScheduler' cannot be annotated with either
SWIFT_RETURNS_RETAINED or SWIFT_RETURNS_UNRETAINED because it is not returning a
SWIFT_SHARED_REFERENCE type
```

Cause: Swift 6.2.4 (Xcode 26.3) rejects `SWIFT_RETURNS_RETAINED` on
constructors. Earlier Swift accepted it. The class is declared
`SWIFT_SHARED_REFERENCE`, so the annotation was always redundant: Swift's C++
interop already treats a shared-reference type's constructors as returning +1,
which the class's `refCount{1}` initialiser confirms.

Fix: drop the annotation from the two constructors. No semantic change.

Note: `apple/Products/ExpoModulesJSI.xcframework` is only a stub; the
podspec rebuilds the framework from source on every build, so there is no
prebuilt binary to fall back on.

When to remove: when Expo ships a build that compiles under Swift 6.2.4.
Not fixed in `57.0.8` or `57.1.0` (the newest for SDK 57), nor in the
`58.0.0-canary-20260902` build. Same class of failure as
[expo/expo#46242](https://github.com/expo/expo/issues/46242) on SDK 56.

### Why `expo-modules-jsi` is pinned

`package.json` pins `expo-modules-jsi` to exactly `57.0.7`, both as a direct
dependency and as an `overrides` entry. Two things make that necessary rather
than tidy:

- Neither `57.0.8` nor `57.1.0` builds here either. Both still carry the two
  constructor annotations, and once those are patched they fail on
  `sending 'thisPtr' / 'argumentsPtr' / 'resultPtr' risks causing data races`
  in `JavaScriptRuntime.swift`: four sites in 57.0.8, seven in 57.1.0. Upstream
  already asserts those pointers are call-scoped and safe
  (`nonisolated(unsafe) let argumentsPtr`), but the compiler still rejects
  passing them into the closure given to `JavaScriptActor.assumeIsolated`.
  57.0.7 is the newest version this one-line patch is enough for.
- The direct dependency is what makes the patch apply. `overrides` alone
  resolves the version but leaves the package nested under
  `expo-modules-core/node_modules/`, where `patch-package` cannot find the path
  the patch names. Listing it as a direct dependency hoists it back to the top
  level. Remove one and the patch silently stops applying; the build then fails
  with the constructor error again.

`expo-modules-core@57.0.18` declares `expo-modules-jsi ~57.1.0`, and the
override forces `57.0.7` in its place. That works only because every Expo
module is compiled from source together (`ios.usePrecompiledModules: false`);
Expo's precompiled `ExpoModulesCore`, built against 57.1.0, segfaulted at
launch on top of the source-built 57.0.7 (see `docs/deploying.md`). Remove the
pin, the override and the patch together when a published `expo-modules-jsi`
compiles under Swift 6.2.4 unpatched, and rebuild to confirm.

---

## `expo-observe+57.0.23.patch`

Symptom: iOS build fails with:

```
ObserveModule.swift:60:12: error: sending value of non-Sendable type
'[String : [String : Any]]' risks causing data races
```

Cause: Swift 6.2.4 again. `configure()` broadcasts the integrations config
to integration libraries by emitting an event, and `[String: Any]` is not
`Sendable`, so handing it to `emit` crosses an isolation boundary the compiler
will not allow. Present in every published build from `57.0.6` onward;
`57.0.0` to `57.0.3` predate the broadcast and do not have the line at all.

Fix: bind the payload to a `nonisolated(unsafe) let` before emitting. The
dictionary is built at that point and handed over once, never read again from
this side, so the hand-off is sound. It is the same escape hatch Expo's own
`JavaScriptRuntime.swift` uses for its call-scoped pointers.

When to remove: when a published `expo-observe` compiles under Swift 6.2.4.
`57.0.23`, the newest, is what is installed and still fails on that line.
Downgrading instead of patching is not a fix: `57.0.3` loses `filteredParams`
and the third-party integration broadcast.

---

## `expo-modules-core+57.0.18.patch`

Symptom: iOS build fails, only when Expo modules are built from source:

```
EventEmitter.swift:52:17: error: sending 'emitter' risks causing data races
EventEmitter.swift:79:17: error: sending 'emitter' risks causing data races
```

Cause: Swift 6.2.4 once more. `emit` schedules a closure onto the
`@JavaScriptActor` and captures the emitter, which is not necessarily
`Sendable`, as `nonisolated(unsafe) weak let`. Region-based isolation checking
in 6.2.4 no longer accepts that binding crossing into the actor.

Fix: hold the weak reference in a private `@unchecked Sendable` box and
read it back inside the closure. Same object, same lifetime, same reasoning
Expo's own comment gave for the original binding: the closure only reaches
actor-isolated or `Sendable` state through the emitter.

When to remove: when a published `expo-modules-core` compiles under Swift
6.2.4, or when the precompiled modules can be used again (see
`docs/deploying.md`), at which point this source is not built at all.

---

## `@xmtp+react-native-sdk+5.7.0.patch`

Symptom: iOS build fails with:

```
XMTPModule.swift:933:20: error: 'Group' is ambiguous for type lookup in this context
XMTPModule.swift:918:31: error: trailing closure passed to parameter of type
'OptimizedFunctionDescriptor' that does not accept a closure
```

Cause: with Expo's precompiled `ExpoModulesCore`, `SwiftUI.Group` collides
with `XMTPiOS.Group` at the one place `XMTPModule.swift` writes a bare
`[Group]`. The second error is a cascade: with the closure's return type
unresolvable, Swift falls back to the non-closure `AsyncFunction` overload. The
same file compiles unpatched against the source-built `ExpoModulesCore` this
project uses, so today the patch is applied but not exercised. It stays
because it is one line and the precompiled configuration is one setting
away.

Fix: qualify the type as `XMTP.Group` (the Swift module is `XMTP`;
`XMTPiOS` is only a directory name). One line, and it resolves both errors.

When to remove: when `@xmtp/react-native-sdk` publishes a build tested
against Expo SDK 57. This is the concrete form of the "untested on New
Architecture" warning `npx expo-doctor` reports for this package.

---

## Not a patch: `plugins/with-sqlcipher-sqlite-fix.js`

Same family of problem, fixed a different way because it lives in the build
configuration rather than in a package's source.

Symptom: iOS build fails with 19 errors in the SDK's own header:

```
sqlite3ext.h:37:31: error: unknown type name 'sqlite3_context'
```

Cause: SQLCipher (pulled in by the XMTP SDK) is an sqlite3 amalgamation, and
CocoaPods propagates its include guards (`_SQLITE3_H_`, `_SQLITE3RTREE_H_`) to
every target that links it, the app target included.
With those already defined, the iOS SDK's `sqlite3.h` expands to nothing, so any
target building the system `SQLite3` module sees `sqlite3ext.h` with no
`sqlite3` type behind it. Nothing imported SQLite3 until `expo-observe` arrived
(`expo-app-metrics` keeps its metrics in one), which is why this surfaced then
and not before.

Fix: a Podfile `post_install` hook that strips those two guards from the
app target's xcconfig. It has to run after `react_native_post_install`, which
rewrites the same files.

Why a config plugin: `ios/` is generated, so a hand-edited Podfile is lost
at the next `expo prebuild` and the build breaks again with an error that
mentions neither SQLCipher nor Observe.

When to remove: when SQLCipher stops exporting its include guards to
dependents, or when nothing in the tree imports the system `SQLite3` module.

---

## `nativewind+4.2.6.patch`

Symptom: on web, every `platformSelect()` in `tailwind.config.js` reaches the
browser as literal CSS:

```
.font-sans { font-family: platformSelect(ios/System,android/sans-serif,default/var(--font-display)); }
```

The browser drops the declaration and text renders in Times.

Cause: `nativewind/theme` chooses the native implementation of
`platformSelect` whenever `NATIVEWIND_OS` is set at all, but NativeWind's own
Metro plugin sets it to `web` when it builds the web CSS. Its
`tailwind/common.js` makes the same check correctly (`undefined` or `web`
means web); `theme.js` does not.

Fix: the same condition in `theme.js`.

When to remove: when `nativewind/dist/theme.js` treats `NATIVEWIND_OS=web`
as web.

---

## `react-native-reanimated+4.5.1.patch`

Symptom: on web, once an `entering` animation built with `withInitialValues`
(every `Enter.*` preset in `src/design/motion.ts`) has finished, the element is
left `position: absolute` at the pixel rectangle it occupied when the animation
ended. Resize the window and the heading, the buttons and everything else that
entered stay where they were; the rest of the page reflows around the holes.

Cause: `withInitialValues` makes the animation a custom keyframe, and custom
keyframes get a cleanup timer. For entering animations that timer pins the
element to its snapshot with `setElementPosition`. Only the entering path passes
`shouldSavePosition = true`, so nothing else runs that line. Upstream `main`
still has it.

Fix: the cleanup no longer repositions the element. The snapshot itself is still
taken on `animationend`, which is what exiting animations read. The same timer
also clears the `visibility: hidden` an entering element starts with: the
animation is what normally clears it, and one that never starts (the window was
occluded, the tab throttled) used to leave the element hidden for good.

When to remove: when a Reanimated release leaves entering elements in normal
flow after their custom animation ends.

---

## Regenerating a patch

The iOS build writes artifacts inside `node_modules/expo-modules-jsi`
(`.DerivedData/`, `Products/`), and `patch-package` will happily diff all 599 of
them into an 11 MB patch. Always scope the regeneration:

```bash
npx patch-package expo-modules-jsi --include 'RuntimeScheduler\.h$'
```
