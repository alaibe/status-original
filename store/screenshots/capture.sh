#!/usr/bin/env bash
# Captures the App Store screenshots from a clean simulator.
#
# Same starting state, same screens, same order: the simulator is erased, the
# app is installed fresh, and `capture.yaml` creates its own account, so nothing
# in a screenshot comes from a device someone has used.
#
#   store/screenshots/capture.sh              # debug build in DerivedData, needs Metro on :8081
#   store/screenshots/capture.sh path/to.app  # any build, e.g. a release build for submission
#
# Apple requires 6.9" iPhone screenshots at 1320×2868; an iPhone 17 Pro Max
# produces exactly that, and the script refuses anything else.
set -euo pipefail

cd "$(dirname "$0")/../.."

MODEL="${SIM_MODEL:-iPhone 17 Pro Max}"
OUT="store/screenshots/ios-6.9"
EXPECTED="1320 2868"

DEVICE=$(xcrun simctl list devices available | grep "$MODEL (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$DEVICE" ] || { echo "No available simulator named '$MODEL'." >&2; exit 1; }

APP="${1:-$(ls -d ~/Library/Developer/Xcode/DerivedData/StatusOriginal-*/Build/Products/Debug-iphonesimulator/StatusOriginal.app 2>/dev/null | head -1)}"
[ -d "$APP" ] || { echo "No app bundle. Build one (xcodebuild or expo run:ios) or pass its path." >&2; exit 1; }

echo "device  $MODEL ($DEVICE)"
echo "app     $APP"

xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
xcrun simctl erase "$DEVICE"
xcrun simctl boot "$DEVICE"
xcrun simctl install "$DEVICE" "$APP"

# A debug build loads JavaScript from Metro; a release build embeds it. The
# interface comes from the routing table rather than an assumed en0, because a
# blank host produces "Invalid URL: http://:8081" inside the app.
if [ -f "$APP/EXDevLauncher.bundle/Info.plist" ] || [ -d "$APP/Frameworks/EXDevLauncher.framework" ] || [ -z "${1:-}" ]; then
  curl -sf "http://localhost:8081/status" >/dev/null || { echo "Metro is not listening on :8081; start it with npm start." >&2; exit 1; }
  HOST=$(ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')")
  xcrun simctl openurl "$DEVICE" "com.statusoriginal.app://expo-development-client/?url=http%3A%2F%2F${HOST}%3A8081"
  sleep 20
fi

PATH="/opt/homebrew/opt/openjdk/bin:$PATH" ~/.maestro/bin/maestro --device "$DEVICE" \
  test store/screenshots/capture.yaml

# Maestro writes into its own run directory; take the latest.
RUN=$(ls -td ~/.maestro/tests/*/ | head -1)
mkdir -p "$OUT"
rm -f "$OUT"/*.png
cp "$RUN"capture/takeScreenshot/*.png "$OUT"/

for png in "$OUT"/*.png; do
  size=$(sips -g pixelWidth -g pixelHeight "$png" | awk '/pixel/{printf "%s ", $2}' | sed 's/ $//')
  if [ "$size" != "$EXPECTED" ]; then
    echo "$png is $size, not $EXPECTED: wrong simulator." >&2
    exit 1
  fi
done
ls "$OUT"
echo "all $EXPECTED"
