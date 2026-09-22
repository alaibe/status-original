#!/usr/bin/env bash
# Captures the screenshots the user docs show, from a clean simulator, and
# halves them for the web. Same recipe as store/screenshots/capture.sh:
# erase the simulator, install the build, let the flow create its own account.
#
#   docs/screenshots/capture.sh              # debug build in DerivedData, needs Metro on :8081
#   docs/screenshots/capture.sh path/to.app  # any build
set -euo pipefail

cd "$(dirname "$0")/../.."

MODEL="${SIM_MODEL:-iPhone 17 Pro Max}"
OUT="docs/public/screenshots"
WIDTH=660

DEVICE=$(xcrun simctl list devices available | grep "$MODEL (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$DEVICE" ] || { echo "No available simulator named '$MODEL'." >&2; exit 1; }

# The newest debug build, since several worktrees may have one.
APP="${1:-$(ls -td ~/Library/Developer/Xcode/DerivedData/StatusOriginal-*/Build/Products/Debug-iphonesimulator/StatusOriginal.app 2>/dev/null | head -1)}"
[ -d "$APP" ] || { echo "No app bundle. Build one (xcodebuild or expo run:ios) or pass its path." >&2; exit 1; }

echo "device  $MODEL ($DEVICE)"
echo "app     $APP"

xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
xcrun simctl erase "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl install "$DEVICE" "$APP"

if [ -f "$APP/EXDevLauncher.bundle/Info.plist" ] || [ -d "$APP/Frameworks/EXDevLauncher.framework" ] || [ -z "${1:-}" ]; then
  PORT="${METRO_PORT:-8081}"
  curl -sf "http://localhost:$PORT/status" >/dev/null || { echo "Metro is not listening on :$PORT; start it with npm start." >&2; exit 1; }
  HOST=$(ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')")
  xcrun simctl openurl "$DEVICE" "com.statusoriginal.app://expo-development-client/?url=http%3A%2F%2F${HOST}%3A${PORT}"
  sleep 20
fi

PATH="/opt/homebrew/opt/openjdk/bin:$PATH" ~/.maestro/bin/maestro --device "$DEVICE" \
  test docs/screenshots/capture.yaml

RUN=$(ls -td ~/.maestro/tests/*/ | head -1)
mkdir -p "$OUT"
rm -f "$OUT"/*.png
for png in "$RUN"capture/takeScreenshot/*.png; do
  sips --resampleWidth "$WIDTH" "$png" --out "$OUT/$(basename "$png")" >/dev/null
done
ls "$OUT"
