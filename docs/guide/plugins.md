# Plugins & commands

A fresh install is a messenger and nothing else. Everything beyond that is a
plugin that ships in the app switched off. Each one says what it adds and what
it is allowed to reach before you turn it on, and nothing runs, appears in
your chat list or makes a network request until you do.

<div class="phones">
  <figure><img src="/screenshots/plugins.png" alt="Settings → Plugins, each with a switch and a description"><figcaption>Settings → Plugins</figcaption></figure>
</div>

## The plugins

| Plugin | What it adds |
| --- | --- |
| **Status Assistant** | Your on-device space for notes, commands and discovering features. On from the start; it is the Status room. |
| **Wallet** | Balances, sends and payment requests on the networks you switch on. See [Wallet](./wallet). |
| **Browser** | Bookmarked sites, opened in your system browser and connected to your wallet over WalletConnect. |
| **Markets** | Spot prices, and a chat that tells you when one crosses a level or moves by a percentage: `/price btc`, `/alert eth above 3000`. |
| **Names & addresses** | `/address` shares your address in a chat; `/ens name.eth` shows what a name points at. |
| **Bots** | Talk to bots on XMTP by address: `/addbot`, `/startbot`. Bots reply with cards and buttons. |

Turning a plugin on takes effect immediately and adds its own conversation
to the list where it needs one. Turning it off removes that and stops
everything it was doing; its settings are kept for next time.

## Commands

In any chat, type `/` and a picker lists what works there. `/commands` prints
the same list, `/commands wallet` only that plugin's. Commands are scoped: the
wallet's `/send` works in the Wallet room and in a conversation with the
person you are paying, and group commands (`/members`, `/invite`, `/rename`)
only in groups.

Some commands worth knowing:

| Command | Does |
| --- | --- |
| `/commands` | What works in this chat |
| `/plugins`, `/enable`, `/disable` | Manage plugins from the keyboard |
| `/whoami` | Your addresses and public keys |
| `/networks` | Chains on, off, and the default |
| `/send`, `/request`, `/split`, `/balance` | The wallet |
| `/open`, `/scan`, `/connected` | Sites and WalletConnect |
| `/price`, `/alert`, `/alerts` | Markets |
| `/members`, `/invite`, `/remove`, `/rename`, `/leave` | This group |

A command that opens a form (`/send` without arguments) fills the composer
area with the form; one that needs a decision (a send, a signature) always
shows a review step first.
