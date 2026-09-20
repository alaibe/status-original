#!/usr/bin/env bash
#
# Starts the three networks this app speaks, as native processes.
#
#   ./local-net/start.sh           start them
#   ./local-net/start.sh stop      stop them
#   ./local-net/start.sh status    what is running, and the values to paste
#
# Run ./local-net/setup.sh first.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_setup() {
  [ -x "$NWAKU" ] && command -v nak >/dev/null && [ -f "$LIBPQ" ] && return 0
  warn "Not set up yet. Run ./local-net/setup.sh first."
  exit 1
}

start() {
  require_setup
  mkdir -p "$RUN"
  export DYLD_LIBRARY_PATH="$(dirname "$LIBPQ"):${DYLD_LIBRARY_PATH:-}"

  say "Nostr relay on ws://$(lan_ip):7777"
  nak serve --hostname 0.0.0.0 --port 7777 >"$RUN/nostr.log" 2>&1 &
  echo $! > "$RUN/nostr.pid"

  say "nwaku on http://$(lan_ip):8645"
  "$NWAKU" --listen-address=0.0.0.0 --nat=none \
    --rest=true --rest-address=0.0.0.0 --rest-port=8645 --rest-allow-origin='*' \
    --relay=true --store=true \
    --cluster-id=$CLUSTER --num-shards-in-network=$SHARDS \
    --discv5-discovery=false --dns-discovery=false --peer-exchange=false \
    >"$RUN/waku.log" 2>&1 &
  echo $! > "$RUN/waku.pid"

  # A relay with no peers cannot publish: it answers "NoPeersToPublish" while
  # *subscribe* succeeds, so the app appears to receive but never send. A second
  # node gives the first one a mesh to publish into.
  local addr=''
  for _ in $(seq 1 30); do
    addr=$(curl -s -m 2 http://127.0.0.1:8645/debug/v1/info 2>/dev/null \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["listenAddresses"][0])' 2>/dev/null) \
      && [ -n "$addr" ] && break
    sleep 1
  done
  [ -n "$addr" ] || { warn "nwaku did not come up; see $RUN/waku.log"; exit 1; }

  say "nwaku peer, so the first one has somewhere to publish"
  "$NWAKU" --listen-address=0.0.0.0 --nat=none --tcp-port=60001 \
    --rest=true --rest-address=127.0.0.1 --rest-port=8646 \
    --relay=true \
    --cluster-id=$CLUSTER --num-shards-in-network=$SHARDS \
    --discv5-discovery=false --dns-discovery=false --peer-exchange=false \
    --staticnode="$addr" \
    >"$RUN/waku-peer.log" 2>&1 &
  echo $! > "$RUN/waku-peer.pid"

  sleep 6
  status
}

stop() {
  local stopped=0
  for f in "$RUN"/*.pid; do
    [ -f "$f" ] || continue
    kill "$(cat "$f")" 2>/dev/null && stopped=1
    rm -f "$f"
  done
  [ "$stopped" = 1 ] && say "stopped" || say "nothing was running"
}

status() {
  local ip; ip=$(lan_ip)
  echo
  say "Settings → Protocols"
  printf '  %-8s %-16s %s\n' XMTP  "Network"        "dev"
  printf '  %-8s %-16s %s\n' Nostr "Relays"         "ws://$ip:7777"
  printf '  %-8s %-16s %s\n' Waku  "nwaku node URL" "http://$ip:8645"
  echo
  echo "  XMTP needs no local node: its public 'dev' network is separate from"
  echo "  production, so two simulators there reach each other and nobody else."
  echo
  curl -s -m 2 http://127.0.0.1:8645/debug/v1/info >/dev/null 2>&1 \
    && echo "  waku  ✓ answering on 8645" || warn "  waku  ✗ not answering; see $RUN/waku.log"
  nc -z 127.0.0.1 7777 2>/dev/null \
    && echo "  nostr ✓ listening on 7777" || warn "  nostr ✗ not listening; see $RUN/nostr.log"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]"; exit 1 ;;
esac
