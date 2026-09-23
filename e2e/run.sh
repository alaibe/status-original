#!/usr/bin/env bash
# Runs the Maestro suite against the booted iOS simulator.
#
#   ./e2e/run.sh              the whole suite
#   ./e2e/run.sh 03-plugins   one flow
#   ./e2e/run.sh --fresh      wipe the account first, then the whole suite
#   E2E_DEVICE=<udid> ...     pick the simulator when more than one is booted
set -euo pipefail

FRESH=0
if [ "${1:-}" = "--fresh" ]; then
  FRESH=1
  shift
fi

MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
[ -x "$MAESTRO" ] || { echo "maestro not found at $MAESTRO"; exit 1; }

command -v xcrun >/dev/null 2>&1 || {
  echo "This suite is iOS-only and needs Xcode's command line tools."
  echo "Android is not supported yet; see e2e/README.md."
  exit 1
}

if ! xcrun simctl list devices booted | grep -q "Booted"; then
  echo "No booted simulator. Start one, then: npx expo run:ios"
  exit 1
fi

java -version >/dev/null 2>&1 || {
  echo "No Java runtime. Install one:  brew install --cask temurin"
  exit 1
}

curl -sf -m 5 http://localhost:8081/status >/dev/null 2>&1 || {
  echo "Metro is not running. Start it:  npx expo start"
  exit 1
}

# A stale dev client may not contain the native modules in the lock file.
APP_PATH="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -path "*Debug-iphonesimulator*" -name "StatusOriginal.app" -print0 2>/dev/null \
  | xargs -0 ls -dt 2>/dev/null | head -1)"
if [ "${E2E_SKIP_BUILD_CHECK:-0}" != "1" ] \
  && [ -n "$APP_PATH" ] && [ package-lock.json -nt "$APP_PATH" ]; then
  echo "The built app is older than package-lock.json, so a native module may be missing."
  echo "  built: $(date -r "$APP_PATH" '+%Y-%m-%d %H:%M')"
  echo "  deps:  $(date -r package-lock.json '+%Y-%m-%d %H:%M')"
  echo "  fix:   npx expo run:ios      (or E2E_SKIP_BUILD_CHECK=1 to run anyway)"
  exit 1
fi

# Fail promptly when CoreSimulator accepts commands but never answers them.
xcrun simctl listapps booted >/dev/null 2>&1 &
probe=$!
waited=0
while kill -0 "$probe" 2>/dev/null; do
  if [ "$waited" -ge 30 ]; then
    kill -9 "$probe" 2>/dev/null || true
    echo "The booted simulator has stopped responding; CoreSimulator is wedged. Fix it:"
    echo "  xcrun simctl shutdown all"
    echo "  killall -9 com.apple.CoreSimulator.CoreSimulatorService"
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done

# `clearState` does not clear the simulator Keychain.
if [ "$FRESH" = "1" ]; then
  echo "→ Resetting the simulator keychain, so onboarding starts with no account."
  xcrun simctl keychain booted reset
fi

DEVICE=()
[ -n "${E2E_DEVICE:-}" ] && DEVICE=(--device "$E2E_DEVICE")

if [ $# -gt 0 ]; then
  exec "$MAESTRO" ${DEVICE[@]+"${DEVICE[@]}"} test "e2e/$1.yaml"
fi

exec "$MAESTRO" ${DEVICE[@]+"${DEVICE[@]}"} test e2e
