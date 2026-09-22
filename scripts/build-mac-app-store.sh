#!/usr/bin/env bash
#
# Builds and uploads the Mac App Store package.
#
#   scripts/build-mac-app-store.sh          # build the .pkg
#   scripts/build-mac-app-store.sh upload   # build it, then send it to App Store Connect
#
# Different from the DMG in three ways: the app is sandboxed against
# src-tauri/Entitlements.plist, it carries a provisioning profile, and it is
# built without the updater feature because an App Store app may not update
# itself. Tauri produces the .app; the .pkg is productbuild's job.
#
# Needs, from the Apple Developer account:
#   - a Mac App Distribution certificate           APPLE_SIGNING_IDENTITY
#   - a Mac Installer Distribution certificate     APPLE_INSTALLER_IDENTITY
#   - a Mac App Store provisioning profile at src-tauri/embedded.provisionprofile
#   - an App Store Connect API key                 APPLE_API_KEY, APPLE_API_ISSUER
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="Status Original"
BUNDLE="target/universal-apple-darwin/release/bundle/macos/$APP_NAME.app"
PKG="target/universal-apple-darwin/release/bundle/macos/$APP_NAME.pkg"

: "${APPLE_SIGNING_IDENTITY:?set it to the Mac App Distribution identity}"
: "${APPLE_INSTALLER_IDENTITY:?set it to the Mac Installer Distribution identity}"

[ -f src-tauri/embedded.provisionprofile ] || {
  echo "src-tauri/embedded.provisionprofile is missing." >&2
  echo "Download the Mac App Store provisioning profile for com.statusoriginal.app." >&2
  exit 1
}

if grep -q 'TEAMID' src-tauri/Entitlements.plist; then
  echo "src-tauri/Entitlements.plist still says TEAMID. Replace it with the real team id." >&2
  exit 1
fi

./scripts/fetch-tdlib.sh

npx tauri build \
  --bundles app \
  --target universal-apple-darwin \
  --config src-tauri/tauri.appstore.conf.json \
  -- --no-default-features

rm -f "$PKG"
xcrun productbuild \
  --sign "$APPLE_INSTALLER_IDENTITY" \
  --component "$BUNDLE" /Applications \
  "$PKG"

echo "built $PKG"

if [ "${1:-}" = "upload" ]; then
  : "${APPLE_API_KEY:?set it to the App Store Connect key id}"
  : "${APPLE_API_ISSUER:?set it to the App Store Connect issuer id}"
  xcrun altool --upload-app --type macos --file "$PKG" \
    --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
fi
