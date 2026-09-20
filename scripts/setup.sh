#!/usr/bin/env bash
#
# Checks everything this app needs and reports what is missing.
#
#   ./scripts/setup.sh            check, and say how to fix what is missing
#   ./scripts/setup.sh --install  also install what can be installed safely
#   ./scripts/setup.sh --android  include the Android toolchain in the check
#
# Checking and installing are separate on purpose. A setup script that installs
# a JDK and an Xcode toolchain the moment you run it is not one you can run to
# find out what is wrong.
set -uo pipefail

INSTALL=0
ANDROID=0
for arg in "$@"; do
  [ "$arg" = "--install" ] && INSTALL=1
  [ "$arg" = "--android" ] && ANDROID=1
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

missing=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; missing=$((missing + 1)); }
note() { printf '      %s\n' "$1"; }

# Installs via brew when --install was given, otherwise prints the command.
offer() {
  local what="$1" cmd="$2"
  if [ "$INSTALL" = "1" ] && command -v brew >/dev/null 2>&1; then
    note "installing $what…"
    if eval "$cmd" >/dev/null 2>&1; then ok "$what installed"; else note "could not install $what; run: $cmd"; fi
  else
    note "fix: $cmd"
  fi
}

echo
echo "Toolchain"

if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }; then
    ok "node $(node -v)"
  else
    bad "node $(node -v); Expo SDK 57 needs 22.13 or newer"
  fi
else
  bad "node is not installed"
  offer "node" "brew install node"
fi

if command -v git >/dev/null 2>&1; then ok "git"; else bad "git is not installed"; fi

# Xcode proper, not just the command line tools: the simulator and a full SDK
# are what `expo run:ios` needs, and `xcode-select -p` happily points at the CLT.
if xcodebuild -version >/dev/null 2>&1; then
  ok "$(xcodebuild -version | head -1)"
else
  bad "Xcode is not installed, or xcode-select points at the command line tools"
  note "fix: install Xcode from the App Store, then:"
  note "     sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
fi

if xcrun simctl list devices available 2>/dev/null | grep -qE "^[[:space:]]+iPhone"; then
  ok "an iPhone simulator is available"
else
  bad "no iPhone simulator installed"
  note "fix: Xcode ▸ Settings ▸ Components, add an iOS runtime"
fi

echo
echo "Tests"

if java -version >/dev/null 2>&1; then
  ok "java (Maestro needs a JDK; macOS ships none)"
else
  bad "no Java runtime"
  offer "temurin" "brew install --cask temurin"
fi

MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
if [ -x "$MAESTRO" ]; then
  ok "maestro $("$MAESTRO" --version 2>/dev/null | tail -1)"
else
  bad "maestro is not installed"
  if [ "$INSTALL" = "1" ]; then
    note "installing maestro…"
    if curl -Ls "https://get.maestro.mobile.dev" | bash >/dev/null 2>&1; then
      ok "maestro installed"
    else
      note 'fix: curl -Ls "https://get.maestro.mobile.dev" | bash'
    fi
  else
    note 'fix: curl -Ls "https://get.maestro.mobile.dev" | bash'
  fi
fi

if [ "$ANDROID" = "1" ]; then
  echo
  echo "Android"

  # The SDK is found by ANDROID_HOME, and Expo falls back to the standard
  # location, so a working setup can have the variable unset. Check both.
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  if [ -d "$SDK" ]; then
    ok "Android SDK at $SDK"
    [ -n "${ANDROID_HOME:-}" ] || note "ANDROID_HOME is unset; export it in your shell profile:"
    [ -n "${ANDROID_HOME:-}" ] || note "     export ANDROID_HOME=\"$SDK\""
  else
    bad "no Android SDK"
    offer "the Android command line tools" "brew install --cask android-commandlinetools"
    note "then: sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' \\"
    note "               'emulator' 'system-images;android-36;google_apis;arm64-v8a'"
  fi

  for tool in platform-tools/adb emulator/emulator; do
    name="$(basename "$tool")"
    if command -v "$name" >/dev/null 2>&1 || [ -x "$SDK/$tool" ]; then
      ok "$name"
    else
      bad "$name not found"
      note "fix: sdkmanager '$(dirname "$tool")'"
    fi
  done

  avds=""
  if [ -x "$SDK/emulator/emulator" ]; then
    avds="$("$SDK/emulator/emulator" -list-avds 2>/dev/null)"
  elif command -v emulator >/dev/null 2>&1; then
    avds="$(emulator -list-avds 2>/dev/null)"
  fi
  if [ -n "$avds" ]; then
    ok "emulator images: $(echo "$avds" | tr '\n' ' ')"
  else
    bad "no emulator (AVD) created"
    note "fix: avdmanager create avd -n pixel -k 'system-images;android-36;google_apis;arm64-v8a' -d pixel_7"
  fi

  # Gradle is the fussiest thing here. The Android Gradle Plugin supports a
  # specific range of JDKs, and a too-new one fails with an unhelpful Kotlin or
  # class-version error rather than saying the JDK is unsupported.
  if [ -n "${JAVA_HOME:-}" ] || command -v java >/dev/null 2>&1; then
    jmajor="$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)"
    if [ -n "$jmajor" ] && [ "$jmajor" -ge 17 ] && [ "$jmajor" -le 21 ]; then
      ok "JDK $jmajor (in the range Gradle and AGP support)"
    else
      bad "JDK $jmajor; the Android build wants 17 to 21"
      note "the iOS side does not care, so install one alongside and point the build at it:"
      note "     brew install --cask temurin@21"
      note "     export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
    fi
  fi
fi

echo
echo "This project"

if [ -d node_modules ]; then
  ok "node_modules"
else
  bad "dependencies are not installed"
  if [ "$INSTALL" = "1" ]; then
    note "running npm install…"
    if npm install >/dev/null 2>&1; then ok "dependencies installed"; else note "fix: npm install"; fi
  else
    note "fix: npm install"
  fi
fi

# The patches are not optional: without them the XMTP SDK does not compile under
# the current Xcode, so a missing postinstall shows up as a native build error
# with no obvious cause.
if [ -d node_modules ] && [ -d patches ]; then
  applied=1
  for patch in patches/*.patch; do
    [ -e "$patch" ] || continue
    pkg="$(basename "$patch" | sed -E 's/\+[0-9].*$//' | tr '+' '/')"
    [ -d "node_modules/$pkg" ] || applied=0
  done
  if [ "$applied" = "1" ]; then
    ok "patch-package targets present"
  else
    bad "a patched dependency is missing; run: npm install"
  fi
fi

if find "$HOME/Library/Developer/Xcode/DerivedData" -path "*Debug-iphonesimulator*" \
     -name "StatusOriginal.app" 2>/dev/null | grep -q .; then
  ok "a native build exists"
else
  bad "no native build yet"
  note "fix: npx expo run:ios"
fi

echo
if [ "$missing" -eq 0 ]; then
  echo "Ready. Start Metro with 'npm start', then run the tests:"
  echo "  npm test          unit"
  echo "  npm run test:e2e  on the simulator"
else
  echo "$missing thing(s) to sort out."
  [ "$INSTALL" = "1" ] || echo "Re-run with --install to install what can be installed automatically."
fi
echo
exit 0
