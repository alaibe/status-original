#!/usr/bin/env bash
#
# Builds src-tauri/frameworks/libtdjson.dylib, the TDLib the desktop app opens
# at runtime. Swiftgram publishes TDLib for Apple platforms as a static archive
# with OpenSSL and SQLite inside; linking it into the app would clash with the
# SQLCipher rusqlite bundles, so it becomes its own dylib that exports only the
# td_json_client entry points and depends on nothing but the system.
set -euo pipefail

VERSION="1.8.67-d1085f9c"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/frameworks"
STAMP="$DEST/libtdjson.version"

if [ -f "$DEST/libtdjson.dylib" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$VERSION" ]; then
  echo "libtdjson.dylib is already at TDLib $VERSION"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading TDLibFramework $VERSION (about 360 MB)…"
curl -L --progress-bar -o "$TMP/TDLibFramework.zip" \
  "https://github.com/Swiftgram/TDLibFramework/releases/download/$VERSION/TDLibFramework.zip"
unzip -q "$TMP/TDLibFramework.zip" 'TDLibFramework.xcframework/macos-arm64_x86_64/*' -d "$TMP"
ARCHIVE="$TMP/TDLibFramework.xcframework/macos-arm64_x86_64/TDLibFramework.framework/Versions/A/TDLibFramework"

printf '_td_json_client_%s\n' create send receive execute destroy > "$TMP/exports.txt"
UNDEFINED=()
for entry in create send receive execute destroy; do UNDEFINED+=("-Wl,-u,_td_json_client_$entry"); done

mkdir -p "$DEST"
clang++ -dynamiclib -arch arm64 -arch x86_64 -mmacosx-version-min=15.0 \
  "${UNDEFINED[@]}" -Wl,-exported_symbols_list,"$TMP/exports.txt" -Wl,-dead_strip \
  -install_name @rpath/libtdjson.dylib -o "$DEST/libtdjson.dylib" "$ARCHIVE" -lz
codesign --force --sign - "$DEST/libtdjson.dylib"
echo "$VERSION" > "$STAMP"
echo "Built $DEST/libtdjson.dylib from TDLib $VERSION"
