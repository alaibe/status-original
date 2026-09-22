# End-to-end tests

[Maestro](https://maestro.mobile.dev) drives the development build on a booted
iOS simulator.

## Running them

```bash
./scripts/setup.sh --install   # Maestro needs a JDK; macOS ships none
npx expo run:ios
npm start

./e2e/run.sh                   # everything
./e2e/run.sh 01-launch         # one flow
./e2e/run.sh --fresh           # reset the simulator Keychain first
```

A normal run keeps whatever account the simulator already has. `--fresh` wipes
the Keychain, and `00-onboarding` then creates the account the later flows need.

`run.sh` checks for Maestro, Java, Xcode, a booted simulator, Metro, a stale
native build and an unresponsive CoreSimulator before it starts. Each of those
otherwise fails somewhere in the middle of a flow and looks like a bug in the
app.

## The flows

| Flow | Covers |
| --- | --- |
| `00-onboarding` | Creates an account when none exists. |
| `01-launch` | Launches, opens the Status room, returns to Chats. |
| `02-commands` | Runs a command from a chip and from the composer. |
| `03-plugins` | Enables and disables a plugin, and its room. |
| `04-status` | Persists a unique message in the local Status room. |
| `05-settings` | Opens the settings screens and cancels account erasure. |
| `06-browser` | `/commands` discovery and its room-specific list, scrolls the full slash picker to Scan, opens Scan from each entry point, and keeps the swap providers in the Browser room. |
| `07-open` | Opens a bookmark with `/open` in Safari, comes back, checks the composer is free again. |

Shared steps live in `e2e/lib/`: `open-status-room` launches into the Status
room, `send-command` sends its `TEXT` parameter from the composer. Maestro only
enumerates the top level of `e2e/`, so those never run as flows of their own.

## Rules the selectors follow

Use `id:`, never the child text of a pressable. On iOS a pressable row is a
single accessibility element, so its inner text is not a stable selector.

**Use the app's own `Back` control from a chat**, and `id: BackButton` on native
stack screens.

Do not call `hideKeyboard`. Maestro cannot dismiss this app's keyboard with
it; the flows tap a non-interactive area instead.

Generate unique text where a flow asserts persistence. `04-status` uses
`evalScript` so that output left over from an earlier run cannot satisfy its
assertions.

Add a flow when a change adds a screen, or a command someone reaches by hand.

## What this does not cover

Real message delivery is out of reach here: the UI suite never creates a remote
peer. Deterministic adapter coverage is in Jest instead, running two
independently keyed sessions against a fake relay:

```bash
npm test -- --runInBand src/protocols/nostr/adapter.test.ts src/protocols/waku/adapter.test.ts
```

Those tests do not exercise public infrastructure, XMTP native delivery, or
release-build networking. Before a release, exchange a message and a reply
between two clean release installs over each configured protocol by hand.

Android needs its own runner and its own pass over the selectors; `run.sh` and
everything it points at are iOS-specific.

The camera is only checked as far as presentation and dismissal, which the
scanner flow does without requiring camera permission. Reading a real
WalletConnect QR code needs a physical device.

Tapping a chat row during launch is deliberately avoided. Rows can reorder
between Maestro resolving a selector and tapping its coordinates, so the flows
enter the Status room through its app link instead.
