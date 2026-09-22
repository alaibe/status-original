# Echo bot

A working XMTP bot in one file. It exists to prove the app's bot support end to
end, and to make the architectural point concrete: **a bot is just an inbox that
answers**. No Bot API, no token to revoke, no server in the middle.

```bash
cd examples/echo-bot
npm install
XMTP_ENV=production node bot.js
```

It prints its address on startup and persists its key in `.bot-key`, so the
address stays the same across restarts.

Then, in the app:

```
/addbot <that address> Echo
/startbot <that address>
```

Both sides must be on the same XMTP network. Match `XMTP_ENV` to the app's
Settings → XMTP network.

## What it demonstrates

Plain replies. Anything you send comes back.

Inline keyboards. `/start` returns a card with buttons, using the
`status-original.plugin/ui.widget` content type. The buttons carry command
strings: `/reply hi` sends "hi" back as an ordinary message, which is why no
callback protocol is needed at all.

Graceful degradation. A client without the bots plugin shows the `fallback`
string instead of the card, so the conversation still reads.

## The security property

A bot's buttons can only ask you to run a command, and they dispatch through the
same path as typing it. A button labelled "send 10 ETH" still opens the normal
confirmation, because it is literally running `/send`. A bot never executes
anything on your device.

Nobody vets bots. This one sees everything you send it, exactly like a person
would.
