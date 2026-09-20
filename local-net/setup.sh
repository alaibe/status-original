#!/usr/bin/env bash
#
# Installs what the local networks need. Run once; safe to re-run.
#
#   ./local-net/setup.sh
#
# Then ./local-net/start.sh.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

command -v brew >/dev/null || { warn "Homebrew is required: https://brew.sh"; exit 1; }

# A Nostr relay in one binary. `nak serve` is an in-memory relay meant for
# exactly this: no config file, no database, nothing to clean up.
if command -v nak >/dev/null; then
  echo "nak      ✓ already installed"
else
  say "Installing nak (Nostr relay + CLI)…"
  brew install nak
fi

# wakunode2 links against libpq and will not start without it, with an error
# about a missing dylib that says nothing about Postgres, which it does not
# otherwise need.
if [ -f "$LIBPQ" ]; then
  echo "libpq    ✓ already installed"
else
  say "Installing libpq (nwaku links against it)…"
  brew install libpq
fi

if [ -x "$NWAKU" ]; then
  echo "nwaku    ✓ already downloaded"
else
  say "Downloading nwaku…"
  mkdir -p "$RUN"
  curl -fsSL "$NWAKU_URL" -o "$RUN/nwaku.tar.gz"
  tar -xzf "$RUN/nwaku.tar.gz" -C "$RUN"
  rm "$RUN/nwaku.tar.gz"
fi

# Fail here rather than at the first start, where a missing dylib reads as a
# broken node.
DYLD_LIBRARY_PATH="$(dirname "$LIBPQ")" "$NWAKU" --version >/dev/null 2>&1 \
  || { warn "nwaku downloaded but will not run. Try: $NWAKU --version"; exit 1; }

echo
say "Ready. Start the networks with ./local-net/start.sh"
