# Your own bots

This page runs two bots on a home server, a weather bot and a chat bot for the
language models on your own llama-swap, and adds them to the app by name. It
is the setup the developer runs at home: one Linux machine with Docker,
reachable over the home network and Tailscale.

Both bots answer you and nobody else. Allow an hour. You need:

- A Linux machine that stays on, with Docker and Docker Compose.
- Your address. `/whoami` in the app shows it.
- For the chat bot, [llama-swap](https://github.com/mostlygeek/llama-swap)
  running somewhere the machine can reach.
- To add the bots by name, a domain and a reverse proxy that serves HTTPS. The
  examples use Caddy and `example.org`.

[Plugins & commands](./plugins#bots) explains what a bot is and what it can do
in a chat.

## What they do

The weather bot answers a city name with the weather there now, and `/week`
with the next seven days, from [Open-Meteo](https://open-meteo.com). It can
also send you your home forecast every morning.

The llama-swap bot passes what you write to one of your models and sends back
the answer. It keeps the last twenty messages as context. `/models` lists the
models and switches between them, and `/new` starts over.

Both reply with cards and buttons, and `/start` shows what they can do.

## How they stay private

A bot is an XMTP inbox, and anyone who knows its address can write to it.
Every XMTP message is signed by its sender's keys, so the bot knows for certain
who wrote it, and these two answer only the address you give them as `OWNER`.
Anyone else gets "This bot is private." once, and after that the bot ignores
them. It never calls Open-Meteo or your models for them.

The bots make outgoing connections only, to the XMTP network, Open-Meteo and
llama-swap. No port is opened for them. Each one runs as an ordinary user in a
container with a read-only filesystem, no Linux capabilities and a memory
limit, and can write only to its own directory.

The machine running the bots decrypts what you send them, as the other end of
any conversation does. The llama-swap bot sends your messages to your own
models and nowhere else. The weather bot sends Open-Meteo the city names you
ask about.

## The compose file

Each bot is built from its own directory in this app's repository,
[`weather-bot`](https://github.com/alaibe/status-original/tree/main/examples/weather-bot)
and
[`llama-bot`](https://github.com/alaibe/status-original/tree/main/examples/llama-bot).
Put this in an empty directory as `docker-compose.yml`:

```yaml
x-bot: &bot
  user: "1000:1000"
  read_only: true
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]
  mem_limit: 256m
  tmpfs: [/tmp]
  restart: unless-stopped

x-env: &env
  OWNER: ${OWNER}
  XMTP_ENV: production
  PUBLIC_DIR: /public
  TZ: Europe/Paris

services:
  weather-bot:
    <<: *bot
    build:
      context: https://github.com/alaibe/status-original.git#main:examples
      dockerfile: weather-bot/Dockerfile
    environment:
      <<: *env
      WEATHER_CITY: ${WEATHER_CITY}
      WEATHER_DAILY_AT: ${WEATHER_DAILY_AT}
    volumes:
      - ./weather:/data
      - ./public:/public

  llama-bot:
    <<: *bot
    build:
      context: https://github.com/alaibe/status-original.git#main:examples
      dockerfile: llama-bot/Dockerfile
    environment:
      <<: *env
      LLM_BASE_URL: ${LLM_BASE_URL}
      LLM_MODEL: ${LLM_MODEL}
      LLM_API_KEY: ${LLM_API_KEY}
    volumes:
      - ./llama:/data
      - ./public:/public

  bots-web:
    image: nginx:1.29-alpine
    volumes:
      - ./public:/usr/share/nginx/html:ro
```

Next to it, a `.env`:

```sh
OWNER=0xYourAddress
WEATHER_CITY=Paris
WEATHER_DAILY_AT=07:30
LLM_BASE_URL=http://llm-host:8080/v1
LLM_MODEL=
LLM_API_KEY=
```

`WEATHER_DAILY_AT` is the time of the morning forecast; leave it empty for
none. With `LLM_MODEL` empty the bot uses the first model llama-swap lists.
`LLM_API_KEY` is only needed if your llama-swap asks for one.

Create the three directories yourself, so they belong to your user and not to
root. The bots cannot write to them otherwise:

```sh
mkdir weather llama public
```

## Give them names

Each bot writes a small file about itself when it starts:
`public/.well-known/status-bot/weather.json` holds its address, name and a
line about what it does. `bots-web` serves that directory, and when you type
`weather@bots.example.org` the app reads
`https://bots.example.org/.well-known/status-bot/weather.json` to find the bot.

With Caddy:

```
bots.example.org {
    header Access-Control-Allow-Origin *
    reverse_proxy bots-web:80
}
```

Caddy has to reach `bots-web`, so put them on a shared Docker network. The
header lets the Mac app read the file.

The name only has to work for you. If the machine is only on your home network
and Tailscale, a local DNS entry for `bots.example.org` and a DNS-01
certificate are enough, and nothing has to be added at your DNS provider
beyond what the certificate needs. Away from home the name resolves while your
phone is on Tailscale. The bots themselves work from anywhere, because they do
not use this server at all.

You can skip names entirely and add the bots by address instead.

## Start them

```sh
docker compose up -d --build
docker compose logs weather-bot llama-bot
```

Each bot logs its address and who it answers:

```
Weather 0x5C1f… on production, answering 0xyouraddress only
```

In the app:

```
/addbot weather@bots.example.org
/startbot weather@bots.example.org
/addbot llama@bots.example.org
/startbot llama@bots.example.org
```

Each bot appears in your chat list, and `/start` brings back its card with
buttons.

## Keep them running

- Back up the `weather` and `llama` directories. Each holds its bot's key.
  Lose it and the bot comes back with a new address, and you add it again.
- Messages sent while a bot is down are answered when it comes back.
- To update, run `docker compose up -d --build`.

## Write your own

Each bot is a directory in
[`examples`](https://github.com/alaibe/status-original/tree/main/examples)
with one `bot.js`. They share `bot-lib`, which handles the key, the owner check
and catching up, and calls your function with each message from you and a way
to reply, as text or as a card. `echo-bot` is the smallest, at about twenty
lines. Copy it, and add a service like the two above with its `dockerfile`.
