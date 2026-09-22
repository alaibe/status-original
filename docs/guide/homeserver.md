# Your own homeserver

This page sets up a Matrix homeserver with bridges to Messenger, Instagram,
Slack and Discord, then connects this app to it. It is the recipe the
developer runs at home: one Linux machine with Docker, reachable over the
home network and Tailscale, with no federation.

Allow an afternoon. You need:

- A Linux machine that stays on, with Docker and Docker Compose.
- A domain you control, for the homeserver's address and its HTTPS
  certificate.
- A reverse proxy that serves HTTPS. The examples use Caddy.

[WhatsApp, Signal & friends](./bridges) explains what a bridge can see before
you decide to run one.

## Pick a server name

Every Matrix ID ends with the server name: `@you:example.org`. It is written
into every user, room and signing key, and it cannot be changed later without
starting again from an empty server.

The server name does not have to be the machine's address. Here the server
name is `example.org` and the homeserver answers at `matrix.example.org`. With
federation off, nothing else is needed to make that work, because this app
asks for the homeserver's address directly.

## The compose file

One Postgres holds a database for Synapse and one per bridge. Put this in an
empty directory as `docker-compose.yml`, with a `.env` next to it that sets
`POSTGRES_PASSWORD` to a long random string.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: synapse
      POSTGRES_INITDB_ARGS: --encoding=UTF-8 --lc-collate=C --lc-ctype=C
    volumes:
      - ./postgres:/var/lib/postgresql/data
    configs:
      - source: bridge-databases
        target: /docker-entrypoint-initdb.d/bridges.sql

  synapse:
    image: matrixdotorg/synapse:v1.161.0
    restart: unless-stopped
    depends_on: [postgres]
    volumes:
      - ./synapse:/data

  mautrix-meta:
    image: dock.mau.dev/mautrix/meta:v0.2609.0
    restart: unless-stopped
    volumes:
      - ./bridges/meta:/data

  mautrix-instagram:
    image: dock.mau.dev/mautrix/meta:ig-v0.2609.0
    restart: unless-stopped
    volumes:
      - ./bridges/instagram:/data

  mautrix-slack:
    image: dock.mau.dev/mautrix/slack:v0.2609.0
    restart: unless-stopped
    volumes:
      - ./bridges/slack:/data

  mautrix-discord:
    image: dock.mau.dev/mautrix/discord:v0.7.7
    restart: unless-stopped
    volumes:
      - ./bridges/discord:/data

configs:
  bridge-databases:
    content: |
      CREATE DATABASE meta OWNER synapse;
      CREATE DATABASE instagram OWNER synapse;
      CREATE DATABASE slack OWNER synapse;
      CREATE DATABASE discord OWNER synapse;
```

Messenger and Instagram are two separate bridges from the same project, with
two images and two databases. Pin whatever versions are current when you set
up; the ones above were current in September 2026.

The `C` collation on Postgres is what Synapse requires. The extra databases are
created only the first time Postgres starts on an empty directory, so add any
later bridge's database by hand with `createdb`.

## Configure Synapse

Generate the configuration and the server's signing key:

```sh
docker run --rm -v ./synapse:/data \
  -e SYNAPSE_SERVER_NAME=example.org -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:v1.161.0 generate
```

Then change these fields in `synapse/homeserver.yaml`:

```yaml
public_baseurl: https://matrix.example.org/
listeners:
  - port: 8008
    type: http
    x_forwarded: true
    bind_addresses: ['0.0.0.0']
    resources:
      - names: [client]
database:
  name: psycopg2
  args:
    user: synapse
    password: <POSTGRES_PASSWORD>
    database: synapse
    host: postgres
federation_domain_whitelist: []
trusted_key_servers: []
enable_registration: false
app_service_config_files:
  - /data/appservices/doublepuppet.yaml
  - /data/appservices/meta.yaml
  - /data/appservices/instagram.yaml
  - /data/appservices/slack.yaml
  - /data/appservices/discord.yaml
```

The listener serves only the client API and the federation list is empty, so
the server talks to nobody but its own users and bridges. Synapse 1.114 or
newer supports the sliding sync this app needs with no extra setting.

## Configure each bridge

Each bridge writes its own configuration the first time it runs, then exits:

```sh
docker compose run --rm mautrix-meta
```

Edit `bridges/meta/config.yaml`:

| Field | Value |
| --- | --- |
| `homeserver.address` | `http://synapse:8008` |
| `homeserver.domain` | `example.org` |
| `appservice.address` | `http://mautrix-meta:29319` |
| `appservice.hostname` | `0.0.0.0` |
| `database.type` | `postgres` |
| `database.uri` | `postgres://synapse:<POSTGRES_PASSWORD>@postgres/meta?sslmode=disable` |
| `bridge.permissions` | `example.org: user` and `"@you:example.org": admin` |
| `encryption.allow` and `encryption.default` | `true` |

Run the same command again. This time it writes `registration.yaml`, which
tells Synapse how to reach the bridge. Copy it to
`synapse/appservices/meta.yaml`.

Repeat for the other three. The ports differ: Instagram listens on 29330,
Slack on 29335 and Discord on 29334. Discord's configuration uses an older
layout, so its database fields are under `appservice.database` and its
encryption fields under `bridge.encryption`. A field set in the wrong place is
ignored without an error.

With encryption on, chats between this app and the bridge are end-to-end
encrypted. The bridge itself decrypts them, on your machine.

## Double puppeting

Without double puppeting, a message you send from the real Messenger or Slack
app shows up in Matrix as a ghost user with your name. With it, the bridge
posts it as you.

Create `synapse/appservices/doublepuppet.yaml`, with two random strings of
your own:

```yaml
id: doublepuppet
url:
as_token: <random string>
hs_token: <another random string>
sender_localpart: <a third random string>
rate_limited: false
namespaces:
  users:
    - regex: '@.*:example\.org'
      exclusive: false
```

Then give each bridge the same `as_token`. In Messenger, Instagram and Slack
that is `double_puppet.secrets`; in Discord it is
`bridge.login_shared_secret_map`:

```yaml
example.org: as_token:<the as_token above>
```

## Put it behind HTTPS

The app needs the client API over HTTPS, and only two paths of it. With Caddy:

```
matrix.example.org {
    reverse_proxy /_matrix/* synapse:8008
    reverse_proxy /_synapse/client/* synapse:8008
}
```

Caddy has to reach the `synapse` container, so put both on a shared Docker
network. If the machine is only on your home network and Tailscale, a local
DNS entry for `matrix.example.org` and a DNS-01 certificate are enough; nothing
has to be open to the internet. The bridges only make outgoing connections.

## Start it

```sh
docker compose up -d
docker compose exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml -u you --admin http://localhost:8008
```

`https://matrix.example.org/_matrix/client/versions` should answer with a list
of versions. Each bridge's log should end with `Bridge started`.

In this app, open **Settings → Protocols → Matrix** and enter
`https://matrix.example.org` and `@you:example.org`. [Networks](./networks#matrix)
has the rest.

## Sign in to each network

Start a chat with the bridge's bot and send `login`. The bot lists the ways it
can sign in; send `login` followed by the one you want, then answer its
questions in the same chat.

| Bot | Network | Ways to sign in |
| --- | --- | --- |
| `@facebookbot:example.org` | Messenger, Facebook | `messenger-lite`: email and password. `facebook` or `messenger`: cookies copied from the website |
| `@instagrambot:example.org` | Instagram | `android` or `instagram-password`: username and password. `instagram`: cookies copied from the website |
| `@slackbot:example.org` | Slack | Email and a confirmation code, or a token and cookie from the browser. One sign-in per workspace |
| `@discordbot:example.org` | Discord | `login-qr`: scan the QR code with the Discord app on your phone. `login-token`: a token from the browser |

Copying cookies means opening the site in a desktop browser, signing in, and
reading the cookie values from the developer tools. That is easiest on a Mac,
with this app open next to the browser. Messenger and Instagram sometimes ask
you to confirm the new sign-in from the phone app.

Once signed in, your chats appear in this app's list as Matrix conversations
and fill in as the bridge catches up. `help` in the bot's chat lists what else
it can do, including `logout`.

## Keep it running

- Back up the Postgres databases, all five of them, and the `synapse`
  directory. The directory holds the signing key and uploaded media, and the
  databases hold every bridge's sign-in sessions.
- Update by changing the image tags and running `docker compose up -d`. Read a
  bridge's release notes first; a new version sometimes needs a configuration
  change.
- If a network signs the bridge out, send `login` to its bot again. Your
  chats stay where they were.
