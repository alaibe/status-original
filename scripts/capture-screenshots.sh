#!/usr/bin/env bash
# Captures screenshots from a clean simulator.
#
#   scripts/capture-screenshots.sh store            # App Store, 1320×2868, verified
#   scripts/capture-screenshots.sh docs             # user guide, halved for the web
#   scripts/capture-screenshots.sh store path/to.app
#
# The simulator is erased and the flow creates its own account, because this is
# a messenger: a screenshot taken on a device someone has used holds real
# conversations, addresses and names, and a store listing is the most public
# place those could end up.
#
# SIM_MODEL and METRO_PORT override the defaults.
set -euo pipefail

cd "$(dirname "$0")/.."

case "${1:-}" in
  store)
    FLOW="store/ios/capture.yaml"
    OUT="store/ios/screenshots/6.9"
    # Apple requires 6.9" iPhone screenshots at exactly this size.
    EXPECTED="1320 2868"
    WIDTH=""
    ;;
  docs)
    FLOW="docs/screenshots/capture.yaml"
    OUT="docs/public/screenshots"
    EXPECTED=""
    WIDTH=660
    ;;
  *)
    echo "usage: $0 <store|docs> [path/to.app]" >&2
    exit 1
    ;;
esac

MODEL="${SIM_MODEL:-iPhone 17 Pro Max}"
PORT="${METRO_PORT:-8081}"

DEVICE=$(xcrun simctl list devices available | grep "$MODEL (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$DEVICE" ] || { echo "No available simulator named '$MODEL'." >&2; exit 1; }

# The newest debug build, since several worktrees may have one.
APP="${2:-$(ls -td ~/Library/Developer/Xcode/DerivedData/StatusOriginal-*/Build/Products/Debug-iphonesimulator/StatusOriginal.app 2>/dev/null | head -1)}"
[ -d "$APP" ] || { echo "No app bundle. Build one (xcodebuild or expo run:ios) or pass its path." >&2; exit 1; }

echo "device  $MODEL ($DEVICE)"
echo "app     $APP"
echo "flow    $FLOW"

xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
xcrun simctl erase "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl install "$DEVICE" "$APP"

# A debug build loads JavaScript from Metro; a release build embeds it. The
# interface comes from the routing table rather than an assumed en0, because a
# blank host produces "Invalid URL: http://:8081" inside the app.
if [ -f "$APP/EXDevLauncher.bundle/Info.plist" ] || [ -d "$APP/Frameworks/EXDevLauncher.framework" ] || [ -z "${2:-}" ]; then
  curl -sf "http://localhost:$PORT/status" >/dev/null || { echo "Metro is not listening on :$PORT; start it with npm start." >&2; exit 1; }
  HOST=$(ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')")
  xcrun simctl openurl "$DEVICE" "com.statusoriginal.app://expo-development-client/?url=http%3A%2F%2F${HOST}%3A${PORT}"
  sleep 20
fi

PATH="/opt/homebrew/opt/openjdk/bin:$PATH" ~/.maestro/bin/maestro --device "$DEVICE" test "$FLOW"

# Maestro writes into its own run directory; take the latest.
RUN=$(ls -td ~/.maestro/tests/*/ | head -1)
mkdir -p "$OUT"
rm -f "$OUT"/*.png

if [ -n "$WIDTH" ]; then
  for png in "$RUN"capture/takeScreenshot/*.png; do
    sips --resampleWidth "$WIDTH" "$png" --out "$OUT/$(basename "$png")" >/dev/null
  done
else
  cp "$RUN"capture/takeScreenshot/*.png "$OUT"/
fi

if [ -n "$EXPECTED" ]; then
  for png in "$OUT"/*.png; do
    size=$(sips -g pixelWidth -g pixelHeight "$png" | awk '/pixel/{printf "%s ", $2}' | sed 's/ $//')
    if [ "$size" != "$EXPECTED" ]; then
      echo "$png is $size, not $EXPECTED: wrong simulator." >&2
      exit 1
    fi
  done
fi

ls "$OUT"
