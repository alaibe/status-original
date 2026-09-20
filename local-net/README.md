# The three networks, on this machine

```bash
./local-net/setup.sh          # once: install nak and libpq, download nwaku
./local-net/start.sh          # every time: start them
./local-net/start.sh status   # what is running, and the values to paste
./local-net/start.sh stop
```

`setup.sh` installs; `start.sh` runs. Both are safe to re-run, and `start.sh`
refuses with a pointer to `setup.sh` rather than failing halfway through if the
binaries are not there yet. The constants they share (where nwaku lives, which
cluster it runs on) are in `common.sh`, so the two cannot drift.

Then open Settings → Protocols in the app and paste what `status` prints.

Native binaries, no containers: `nak` for Nostr, `nwaku` for Waku, and nothing
at all for XMTP, whose public `dev` network is separate from production, so two
simulators pointed there reach each other and nobody else.

## Why this exists

Waku could not be tested at all. The app is a client of nwaku's REST API,
and the public Waku fleet speaks libp2p, so there is no endpoint on the
internet to point it at. This is the only way to run that code.

The other two are testable in production, which is the problem: it means
testing a messenger by sending real messages to a real network.

## What the script knows that is not obvious

Each of these cost an hour to find, and each fails in a way that looks like a
bug in the app rather than in the setup.

- `libpq`: `wakunode2` links against it and exits with `could not load:
  libpq.dylib`, with no mention of Postgres, which it does not otherwise need.
- Cluster 16, not 1: cluster 1 is The Waku Network preset, which mandates RLN
  (rate limiting backed by an Ethereum contract). nwaku refuses to relay
  without it: "network preset mandates RLN relay".
- `--num-shards-in-network`: without it a custom cluster uses static sharding,
  and the `/relay/v1/auto/*` endpoints the app calls answer "Autosharding is
  disabled". This flag is what turns autosharding on.
- Two nwaku nodes: a relay with no peers cannot publish. It answers
  `NoPeersToPublish` while subscribe succeeds, so the app appears to receive
  but never send. The second node exists solely to give the first a mesh.
- `--nat=none`, discovery off: otherwise the node spends its startup looking
  for the real Waku network, which it must not join.

## A bug this found

The app's Waku history query pinned `pubsubTopic` to a fixed shard while relay
used the `/auto/` endpoints, where the node derives the shard from the content
topic. Any content topic that did not happen to hash to the pinned shard would
receive live messages and come back empty on reload, because history asked
one shard while messages arrived on another.

Fixed by letting the node derive it in both places, which also removed the
"Pubsub topic" setting: a field whose only effect was to get this wrong.

## Two clients, one machine

The point of a local network is talking to yourself from two installs. Boot two
simulators, run the app on both, give each its own account.

```bash
xcrun simctl list devices available | grep iPhone
xcrun simctl boot <first-udid> && xcrun simctl boot <second-udid>
```

## Caveats

- nwaku is a nightly build. macOS binaries ship only under the rolling
  `nightly` tag; versioned releases carry source and Linux artefacts. Pin a
  downloaded copy if you need the same node twice.
- Apple silicon only. The download is `arm64-macos`.
- `nak serve` is in-memory. Stopping it loses every event, which is usually
  what you want and occasionally is not.
