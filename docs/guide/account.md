# Your account

Your account is a recovery phrase: twelve words the app generates on your
device. Everything follows from it: your messaging identity on every
network, and the Ethereum, Bitcoin and Solana addresses the wallet uses.
There is no password to forget and no server that knows you exist.

<div class="phones">
  <figure><img src="/screenshots/welcome.png" alt="The welcome screen"><figcaption>The welcome screen</figcaption></figure>
  <figure><img src="/screenshots/recovery-phrase-hidden.png" alt="The recovery phrase screen before it is revealed"><figcaption>Reveal the phrase, write it down, confirm</figcaption></figure>
</div>

## Create an account

1. Tap **Create an account**.
2. Tap **Reveal recovery phrase** and write the twelve words down, in order,
   on paper. Not in a screenshot, not in a note that syncs somewhere.
3. Tap **I've written it down**.

That is the whole sign-up. The chat list opens with one conversation, the
Status room, which holds help and commands.

::: warning Nobody can reset this
The phrase is the account. If you lose the phrase and the device, the
account and anything in its wallet are gone. Nobody at Status, Apple or Google
can bring them back, because none of them ever had them.
:::

## Restore an account

Tap **I already have a recovery phrase** and enter the twelve words. Your
addresses come back exactly as they were. Chat history does not travel with
the phrase; [Networks](./networks) says what each network keeps.

## Use a hardware wallet

Tap **Connect a hardware wallet** to create an account whose key lives on a
Ledger, Trezor or Keystone instead of the phone. Messaging works as usual;
anything that needs a signature (sending funds, connecting a site) happens
on the device, and the key never touches the phone.

Some networks need a key the hardware cannot give (Bitcoin and Solana on a
Ledger need the device's own apps for those chains). The app says so where
it matters and suggests switching to a phrase-based account for those.

## Several accounts

Settings → **Accounts** holds every account on this device. Add one from a new
phrase, an existing phrase or a hardware wallet; switch between them from the
same screen. Each account has its own history, plugins, keys and settings.
Nothing is shared between them.

## Lock it

Settings → **Recovery phrase** shows the phrase again (after Face ID or your
passcode) and lets you turn on **key protection**, which asks for Face ID
before the phrase or a signature is used. The phrase is stored in the device
keychain and never leaves it.

## Erase an account

Settings → **Erase this account** removes the account's messages, media,
keys and settings from this device, and signs out of Telegram and Matrix if
they were connected. It does not delete anything on those networks, and it
does not touch the recovery phrase you wrote down: the same phrase restores
the same account later.
