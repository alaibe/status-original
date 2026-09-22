# Contributing

## Start here

Read [`AGENTS.md`](AGENTS.md) first. It is a page long and it applies to people
as much as to agents: the pinned Expo SDK's own documentation is the reference,
comments explain only what the code cannot, and a handful of things in this
repository are generated or load-bearing in ways the code does not announce.

Set up with the [Quick start](README.md#quick-start) in the README. Run
`./scripts/setup.sh` whenever something stops working; it checks Node, Xcode,
the simulator, Java, Maestro, `node_modules`, the applied patches and whether a
native build exists, and prints the command that fixes each one.

Native dependencies changed? `npx expo prebuild --platform ios` then
`npx pod-install`. `ios/` and `android/` are generated and are not committed.

## Checks

```bash
npm run typecheck
npm run lint
npm test            # 93 Jest suites
npm run test:e2e    # Maestro, needs a booted simulator and Metro
npm run test:all    # all four in that order
```

All four pass before a pull request opens. The e2e suite drives a debug build;
[`e2e/README.md`](e2e/README.md) covers its selector rules (`id:`, never the
child text of a pressable) and what each flow covers. Add a flow when a change
adds a screen or a command someone reaches by hand.

## The shape of the codebase

```text
src/
  app/          Expo Router routes: onboarding, tabs, chat, modals
  core/
    app/        account runtime, boot, notifications, erase
    identity/   accounts, keyring, SLIP-10, hardware vendors, locking
    messaging/  the chat domain: stores, history, previews, folders, unread
    commands/   command parsing and the group commands every protocol shares
    plugins/    plugin contracts, registry, host, per-plugin storage
  protocols/    XMTP, Nostr, Waku, Telegram, Matrix: descriptor + adapter each
  storage/      account-scoped SQLCipher, vault, media, erase, inventory
  design/       tokens, components, motion, and the widget schema
  features/     chat, contacts, identity, navigation, settings UI
  plugins/      assistant, profile, bots, wallet, browser, markets
  desktop/      what the web build substitutes for the desktop window
src-tauri/      the desktop window: Rust for SQLCipher, vault, Ledger, TDLib, Matrix
```

`AccountRuntime` owns one account's storage, protocol sessions, plugins and
local bots, and tears all of it down on a switch. Account data is split by
medium: recovery phrases, database keys and credentials in SecureStore;
conversations and messages in one SQLCipher database per account; preferences in
account-scoped AsyncStorage; media in account-scoped directories. Erasing an
account removes every part before the keys.

### A network

`src/protocols/<name>/`: a `ProtocolDescriptor` and an adapter implementing
`ChatSession`, which is all the app knows about a network. XMTP, Telegram and
Matrix implement it over their SDK's own encrypted database; Nostr and Waku
implement it over `StoreBackedSession` on the app's `MessageStore`, so transport
code never touches persistence. A session that needs interactive sign-in reports
which step it is waiting on, and the protocol's settings screen walks through
it. Conversation and message ids carry their protocol before they reach the
unified store.

The descriptor carries the label, the config schema its settings screen renders,
the copy the new-chat screen uses to ask for a recipient, a `trustModel` string
saying plainly what the network does and does not protect, a `docsUrl` pointing
at that network's section of the user guide, and `connect`. Adding a network
means adding a descriptor and an adapter; no UI knows the list, and nothing else
should learn the network's name.

`src/protocols/*/testing/` holds a fake for each, and the adapter tests run two
independently keyed sessions against it.

### A plugin

`src/plugins/<name>/`, returning its contributions from `setup()`: commands,
content types, bots, composer actions, URI handlers and overlays. Declare the
permissions it genuinely needs in the manifest, because that list is shown to
the person before they switch it on. Register it in `src/plugins/index.ts`, and
only add it to `DEFAULT_ENABLED_PLUGINS` if a fresh install should really have
it running.

Anything a person can type as `/something` is a `SlashCommand` from a plugin, or
a core command in `src/core/commands`. Core commands get no plugin context and
must not reach for one.

### Anything that appears in a chat

Data, not a component. Build it from `src/design/widgets/schema.ts` and give it
a plain-text `fallback`, because the message will be stored, forwarded and
eventually rendered by a client that has never heard of the plugin that made it.
A content type ships its codec and its renderer together for the same reason.
Keep the union additive.

### Colour

NativeWind classes or `useThemeColors()`. Change `src/design/tokens.ts` and run
`npm run theme:build`; `src/global.css` is output.

### The desktop

A `.web.ts` or `.web.tsx` beside the phone version, never a branch inside it.
Add the phone file first: Expo Router needs a non-platform file for every route.
Where the phone gets a native package, the desktop calls a Rust command in
`src-tauri/src/` through `@tauri-apps/api`:

| Module | Phone | Desktop |
| --- | --- | --- |
| `storage/sqlite-engine` | expo-sqlite with SQLCipher | `db.rs`: rusqlite with SQLCipher, one connection per database |
| `storage/secure-store` | expo-secure-store | `vault.rs`: one AES-256-GCM file, key in the OS credential store |
| `core/identity/vendors/ledger` | Bluetooth | `ledger.rs`: USB HID, with `@ledgerhq/hw-app-eth` over a transport that relays APDUs |
| `features/contacts/device-contacts` | expo-contacts | `contacts.rs`: the macOS Contacts framework |
| `core/notifications` | expo-notifications | `tauri-plugin-notification` |
| `lib/open-url` | in-app browser | `tauri-plugin-opener` |
| `lib/share` | the share sheet | the clipboard |
| `protocols/telegram/td-client` | `react-native-tdlib` | `tdlib.rs`: `libtdjson.dylib` via `libloading` |
| `protocols/matrix/client` | `@unomed/react-native-matrix-sdk` | `matrix.rs`: the `matrix-sdk` crates in-process |

XMTP is the exception: `@xmtp/browser-sdk` runs libxmtp as WebAssembly in a Web
Worker. `paths.rs` validates every database and account directory name the page
asks for against an allow-list.

`npm run desktop` takes port 8082 so it can run beside the phone's Metro on
8081, and fetches TDLib on first run. Do not set `CI=true` for it: Metro reads
that and switches off file watching.

## Generated files

Commit what the build wrote, never a hand edit of it.

| Output | Source | Command |
| --- | --- | --- |
| `src/global.css` | `src/design/tokens.ts` | `npm run theme:build` |
| `assets/brand/mark.svg`, `assets/images/`, `store/play/`, `src-tauri/icons/`, the colour fields in `app.json` | `assets/brand/status-logo-2018.png` | `npm run brand:build` |
| `ios/`, `android/` | `app.json` | `npx expo prebuild` |
| `src/lib/evm/token-list.json` | tokenlists.org | `npm run tokens:build` |
| `src/plugins/wallet/solana/token-list.json` | Jupiter | `npm run tokens:build:solana` |

`npm run brand:build` needs `brew install librsvg`. Both of its steps are
deterministic, so a second run is byte-identical. A test fails if `mark.svg`
drifts from the source image, and another if the `brand` token in
`src/design/tokens.ts` no longer matches the logo's plate colour. A new logo
therefore means `brand:build`, then the token, then `theme:build`.

## Patches

[`patches/`](patches/README.md) holds `patch-package` patches for upstream bugs,
applied by `postinstall`. Each one has an entry in that README giving the
symptom (with the real compiler error), the cause, the fix, and the condition
under which it can be deleted. Add a patch only with its entry, and prefer
deleting one over adding one whenever a dependency bump allows it. Scope the
regeneration with `npx patch-package <pkg> --include '<path regex>'`, because
the iOS build leaves artifacts inside `node_modules` that otherwise end up in
the diff.

## Store artifacts

If a change touches onboarding, the chat list, Settings or `app.json`, the
screenshots under `store/ios/screenshots/6.9/` are stale. Regenerate them with
`./scripts/capture-screenshots.sh store` (Metro up), and re-read
`store/ios/review-notes.md` if the change alters what a reviewer sees.
[`store/README.md`](store/README.md) says which file feeds which form.

## Documentation

The site at `docs/` is the **user guide** and nothing else: no architecture, no
decision records, no build instructions. Developer documentation stays in the
repository, in `README.md` and this file. `PRIVACY.md` is included into
`docs/privacy.md`, so editing it changes the published policy.

## Commits and pull requests

One change per commit, and a message that says what it does and why in ordinary
sentences. A pull request says what to look at first and how it was tested.
Uncommitted generated output, a failing check, or a patch without its README
entry comes back.

## Security

Do not open a public issue for a vulnerability. [`SECURITY.md`](SECURITY.md) has
the private route.
