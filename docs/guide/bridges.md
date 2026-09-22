# WhatsApp, Signal & friends

There is no WhatsApp, Signal, Slack, iMessage or Discord code in this app, and
there will not be. Those networks either forbid a third-party client on your
personal account or provide no way to build one.

What the app has is Matrix, and Matrix has **bridges**.

A bridge is a program that runs next to a Matrix homeserver, signs in to the
other network as you, and turns each chat there into a Matrix room. Connect
this app to that homeserver ([Networks → Matrix](./networks#matrix)) and those
rooms appear in your list like any other Matrix DM.

## What you can bridge

The [mautrix](https://github.com/mautrix) bridges cover most of what people
ask for:

| Network | Bridge | How it signs in |
| --- | --- | --- |
| WhatsApp | mautrix-whatsapp | Links as a device, like WhatsApp Web |
| Signal | mautrix-signal | Links as a device |
| iMessage | mautrix-imessage | Runs on a Mac that stays on |
| Messenger, Instagram | mautrix-meta | Your Facebook or Instagram login |
| Google Messages (SMS/RCS) | mautrix-gmessages | Pairs with your Android phone |
| Slack | mautrix-slack | Your Slack login |
| Discord | mautrix-discord | Your Discord login |
| X, LinkedIn, Bluesky, Google Chat, Google Voice, Zulip, IRC | one bridge each | Varies |

## What you need

A Matrix homeserver you control, with the bridge installed next to it: a small
server, a VPS or a box at home, and an afternoon. The mautrix
documentation at [docs.mau.fi](https://docs.mau.fi/bridges/) walks through each
bridge.

If you would rather not run a homeserver, Beeper's
[bridge manager](https://github.com/beeper/bridge-manager) runs the same
bridges against a hosted one.

## What to know before you rely on it

The bridge sees everything. It decrypts what it relays, on the machine
where it runs. The Matrix leg between the bridge and this app can be encrypted;
the bridge itself holds plaintext. Put it somewhere you trust as much as you
trust your phone.

The bridge is you, on the other network. WhatsApp and Signal treat it as a
linked device and are fine with that. Discord forbids unofficial clients, and
Meta sometimes locks accounts that look automated. That is between you and
those networks; this app cannot change it.

It is only as reachable as your server. If the bridge is down, messages
wait on the other network until it comes back.
