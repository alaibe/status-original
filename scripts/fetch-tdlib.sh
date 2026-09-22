#!/usr/bin/env bash
#
# Puts TDLib where the desktop app can open it at runtime, for whichever
# platform this is. Both routes land on TDLib 1.8.67.
#
# macOS builds it: Swiftgram publishes TDLib for Apple platforms as a static
# archive with OpenSSL and SQLite inside, and linking that into the app would
# clash with the SQLCipher rusqlite bundles, so it becomes its own dylib
# exporting only the td_json_client entry points.
#
# Linux and Windows download it from the prebuilt-tdlib npm packages, which
# publish the same version already built. Those carry their OpenSSL statically
# too, but export its symbols, so the app must keep opening them with
# RTLD_LOCAL (libloading's default) to stop TDLib's OpenSSL interposing on the
# one SQLCipher uses.
set -euo pipefail

VERSION="1.8.67-d1085f9c"
# TDLib 1.8.67, in prebuilt-tdlib's own numbering.
PREBUILT="0.1008067.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/frameworks"
STAMP="$DEST/libtdjson.version"

case "$(uname -s)" in
  Darwin)  LIB="libtdjson.dylib"; PKG="" ;;
  Linux)   LIB="libtdjson.so"
           case "$(uname -m)" in
             aarch64|arm64) PKG="linux-arm64-glibc" ;;
             *)             PKG="linux-x64-glibc" ;;
           esac ;;
  MINGW*|MSYS*|CYGWIN*)
           LIB="tdjson.dll"; PKG="win32-x64" ;;
  *)       echo "No TDLib for $(uname -s); Telegram will report itself unavailable." >&2
           exit 0 ;;
esac

if [ -f "$DEST/$LIB" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$VERSION" ]; then
  echo "$LIB is already at TDLib $VERSION"
  exit 0
fi

# Everything but macOS takes the prebuilt library as published.
if [ -n "$PKG" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "Downloading @prebuilt-tdlib/$PKG@$PREBUILT…"
  (cd "$TMP" && npm pack "@prebuilt-tdlib/$PKG@$PREBUILT" --silent >/dev/null)
  tar xzf "$TMP"/*.tgz -C "$TMP"
  mkdir -p "$DEST"
  cp "$TMP/package/$LIB" "$DEST/$LIB"
  echo "$VERSION" > "$STAMP"
  echo "Installed $DEST/$LIB from TDLib $VERSION"
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
