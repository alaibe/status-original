# The desktop app

The desktop app is the Expo web export inside a Tauri window. "Web" in this
codebase means the desktop app: nothing is deployed to a browser, and a plain
browser is only a development surface.

## Running it

Rust is needed on top of the mobile setup (`rustup` is enough; `cargo` must be
on the path).

```bash
npm run desktop          # Metro on 8082 plus a debug window that reloads on save
npm run desktop:build    # dist/ from `expo export`, then src-tauri/target/release/bundle/
```

The desktop Metro takes 8082 so it can run next to the phone's on 8081. Both
read `metro.config.js` once at start, so restart whichever one predates a
change to it.

Both commands first run `scripts/fetch-tdlib.sh`, which on a fresh machine
downloads TDLib (the Telegram client library, about 360 MB once) and turns it
into `src-tauri/frameworks/libtdjson.dylib`. The phone gets TDLib from the
`react-native-tdlib` pod instead; that pod has no macOS build.

Do not set `CI=true` when running `tauri dev`: Metro reads it and switches off
file watching.

## How the platforms split

Every screen and feature is shared. The desktop differs only where a phone
convention has no meaning on a desk, and each of those lives in a `.web.tsx`
or `.web.ts` file next to the phone version:

- `src/features/navigation/app-frame.web.tsx` is the window: the wallpaper,
  the floating sidebar, a drag strip along the top edge and the ⌘K switcher.
  Routes are identical on every platform (Expo Router requires a non-platform
  file for each), so `(tabs)/_layout.web.tsx` only hosts the open group and
  `chats.web.tsx`, `contacts.web.tsx` and `settings/index.web.tsx` are the
  empty pane while the list is in the sidebar.
- `src/features/navigation/tab-stack.tsx` wraps settings pages in a
  `PaneCard` instead of a navigation header, and `dialog.web.tsx` shows the
  modal routes (new chat, QR, invite, profile) as centred dialogs.
- `src/design/components/sheet.web.tsx` turns every sheet into a popover, at
  the pointer when a right-click opened it. `contextMenu()` and the
  `onContextMenu` prop on `ListItem` are the desktop counterpart of
  `onLongPress`; `SwipeableRow` is a pass-through.
- Enter sends in the composer (Shift+Enter breaks the line). ⌘K opens the
  switcher, ⌘N a new message, ⌘, settings, ⌘1/2/3 the tabs, Esc closes.
- The emoji and GIF panel (`src/features/chat/media-panel.web.tsx`) is a
  popover above the button that opened it, with the search focused so you can
  type straight away and press Enter for the first match; the phone version
  rises from the bottom. The grid itself is shared.

## What the Rust side does

`src-tauri/src/` holds the commands the web build calls through
`@tauri-apps/api`, each behind a `.web.ts` implementation of a module the
phone gets from a native package:

| Module | Phone | Desktop |
| --- | --- | --- |
| `storage/sqlite-engine` | expo-sqlite with SQLCipher | `db.rs`: rusqlite built with SQLCipher, one connection per database, keyed by name under the app data directory |
| `storage/secure-store` | expo-secure-store | `vault.rs`: one AES-256-GCM file, its key in the OS credential store (release) or a user-only file (debug, so unsigned rebuilds do not prompt) |
| `core/identity/vendors/ledger` | Bluetooth | `ledger.rs`: USB HID through `ledger-transport-hid`; the Ethereum app protocol stays in `@ledgerhq/hw-app-eth` over a transport that relays APDUs |
| `features/contacts/device-contacts` | expo-contacts | `contacts.rs`: the Contacts framework on macOS (`unavailable` elsewhere); the system prompt names the app bundle, so a debug binary started from a terminal is asked for as that terminal |
| `core/notifications` | expo-notifications | `tauri-plugin-notification` |
| `lib/open-url` | in-app browser / `Linking` | `tauri-plugin-opener` (the window cannot open URLs itself) |
| `lib/share` | the share sheet | the clipboard; invites also open Messages with the recipients through `sms:` |

XMTP uses `@xmtp/browser-sdk` (`src/protocols/xmtp/adapter.web.ts`), which
runs libxmtp as WebAssembly in a Web Worker with its database in the origin's
private file system. Metro cannot see the `.wasm` the worker fetches, so
`scripts/copy-xmtp-wasm.js` (run on `postinstall`) puts it in `public/xmtp/`
and `src/desktop/xmtp-wasm-bindings.ts` points the bindings there.

## Where data lives on macOS

Everything is keyed by the bundle identifier `com.statusoriginal.app`, so a
new build or a moved `.app` keeps it.

- `~/Library/Application Support/com.statusoriginal.app/`: `vault.bin`,
  `databases/account-<id>.db`, and in debug builds `vault.key`.
- Keychain item `com.statusoriginal.app` / `vault-key` in release builds.
- `~/Library/WebKit/com.statusoriginal.app/`: preferences (AsyncStorage),
  XMTP's own database, WalletConnect sessions. This store is per origin, so a
  debug window on `http://localhost` and a release build on `tauri://localhost`
  have separate copies, and each registers its own XMTP installation.

Release builds must be signed with a stable identity for the Keychain's
"Always Allow" to stick; an ad-hoc signed build is a new identity every time it
is compiled.

## Debugging

The window's WebKit has no console you can read from a terminal. Two ways
around it:

- Debug builds evaluate whatever is written to `probe.js` in the app data
  directory (`src-tauri/src/probe.rs`); `console.log` from it shows up in
  Metro's output as `Web LOG`.
- A page that defines a mock `window.__TAURI_INTERNALS__.invoke` (an
  in-memory vault, sql.js for the databases) and loads Metro's web bundle runs
  the whole app in Chrome with devtools.

Two traps: Reanimated's entering animations configure themselves in
`requestAnimationFrame`, which an occluded window or a background tab never
runs, so content can sit hidden until the window is in front; and the WebKit
inspector's right-click menu appears in debug builds even when the page
suppresses its own, which release builds do not do.

## Dependency patches

`patches/README.md` documents the two web-specific ones: NativeWind treating
`NATIVEWIND_OS=web` as native, and Reanimated pinning entering elements in
place after a custom animation on web.
