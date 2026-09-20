# Shared by setup.sh and start.sh. Not executable on its own.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"          # binaries, logs and pids; gitignored
NWAKU="$RUN/build/wakunode2"

# nwaku publishes macOS binaries only under the rolling `nightly` tag; the
# versioned releases carry source and Linux artefacts. Pin a downloaded copy if
# you need the same node twice.
NWAKU_URL="https://github.com/waku-org/nwaku/releases/download/nightly/nwaku-arm64-macos-nightly.tar.gz"

# Cluster 16 rather than 1. Cluster 1 is The Waku Network preset, which
# mandates RLN (rate limiting backed by an Ethereum contract) and nwaku
# refuses to relay without it. 16 is outside the preset, and
# `--num-shards-in-network` is what turns autosharding on there, which the
# app's `/relay/v1/auto/*` calls require.
CLUSTER=16
SHARDS=8

LIBPQ=/opt/homebrew/opt/libpq/lib/libpq.dylib

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

lan_ip() {
  ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')" 2>/dev/null \
    || echo 127.0.0.1
}
