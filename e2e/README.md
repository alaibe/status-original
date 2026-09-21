# End-to-end tests

[Maestro](https://maestro.mobile.dev) drives the development build on a booted
iOS simulator.

## Run

```bash
./scripts/setup.sh --install
npx expo run:ios
npm start

./e2e/run.sh
./e2e/run.sh 01-launch
./e2e/run.sh --fresh
```

A normal run keeps the simulator account. `--fresh` resets the simulator
Keychain, and `00-onboarding` creates the account required by later flows.

## Flows

| Flow | Coverage |
| --- | --- |
| `00-onboarding` | Creates an account when none exists. |
| `01-launch` | Launches, opens the Status room, and returns to Chats. |
| `02-commands` | Runs commands from a chip and the composer. |
| `03-plugins` | Enables and disables a plugin and its room. |
| `04-status` | Persists a unique message in the local Status room. |
| `05-settings` | Opens settings screens and cancels account erasure. |
| `06-dapps` | Checks `/commands` discovery and its room-specific list, scrolls the full slash picker to Scan, opens Scan through each entry point, and keeps swap providers in Dapps. |
| `07-browse` | Opens a dapp with `/browse`, dismisses the in-app browser, and checks the composer is free again. |

Shared steps live in `e2e/lib/`: `open-status-room` launches into the Status
room and `send-command` sends its `TEXT` parameter from the composer. Maestro
only enumerates the top level of `e2e/`, so they never run as flows on their own.

Use `id:` selectors for app controls. Pressable rows are single accessibility
elements on iOS, so their child text is not a stable selector. Use the app's
`Back` control from a chat and `id: BackButton` on native stack screens.

Maestro cannot dismiss this app's keyboard with `hideKeyboard`; the flows tap a
non-interactive area instead. `04-status` creates unique text with `evalScript`
so persisted output from an earlier run cannot satisfy its assertions.

## Messaging check

The UI suite does not create a remote peer. Deterministic adapter coverage uses
independently keyed sessions:

```bash
npm test -- --runInBand src/protocols/nostr/adapter.test.ts src/protocols/waku/adapter.test.ts
```

Before release, exchange a unique message and reply between two clean release
installations over each configured protocol. The adapter tests do not verify
public infrastructure, XMTP native delivery, or release-build networking.

## Current limitations

`run.sh` and the selectors are iOS-specific. Android has not been built or run
in this repository, so Android E2E coverage remains unresolved.

The scanner flow checks presentation and dismissal without requiring camera
permission. Reading a WalletConnect QR code requires a physical device.

Chat rows can reorder between Maestro resolving a selector and tapping its
coordinates. Flows enter Status through its app link, so direct row tapping
during launch-time reordering is not covered reliably.

The runner checks for Maestro, Java, Xcode, a booted simulator, Metro, a stale
native build, and an unresponsive CoreSimulator before starting the flows.
