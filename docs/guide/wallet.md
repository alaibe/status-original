# Wallet

The recovery phrase behind your account is also a wallet for Ethereum (and the
networks built on it), Bitcoin and Solana. The wallet is a plugin, off on a
fresh install; turn it on under Settings → **Plugins** and a **Wallet**
conversation appears in your chat list.

<div class="phones">
  <figure><img src="/screenshots/wallet.png" alt="The Wallet conversation with its command chips"><figcaption>The Wallet room: balance, send, request, networks</figcaption></figure>
  <figure><img src="/screenshots/wallet-send.png" alt="The send form: network, asset, amount, recipient, review"><figcaption>A send always goes through a review step</figcaption></figure>
</div>

Everything the wallet does is a command, in its own room or in any chat where
money comes up. The chips above the composer run the common ones.

## Networks

`/networks` lists the chains, switches them on or off and picks the default.
Ethereum, Base, Optimism, Arbitrum and Polygon are on the Ethereum side;
Bitcoin and Solana are their own. Every command uses the default chain unless
you add `--chain bitcoin` (or `base`, `solana`, …). Test networks such as
Sepolia say so on every card, because their coins are worth nothing.

## Balance

`/balance` shows your balance on the default chain; `/balance vitalik.eth`
or `/balance 0x…` looks someone else up. The card has the address, the amount
and a link to the block explorer.

Token balances need an Alchemy key, which you enter under Settings →
**Tokens**. Without it, native balances and sends still work; only the list of
tokens you hold is missing. That is a deliberate choice: the app ships with
no keys of its own, so no third party sees your addresses unless you decide
they should.

## Send

`/send 0.01 vitalik.eth` (or just `/send`, and fill in the form). Pick the
network and the asset, enter the amount and who to, and tap **Review**. The
review shows exactly what will be signed (amount, recipient, fee), and
nothing is signed until you confirm. Hardware accounts confirm on the
device.

Sending in a chat with the person is the natural way: the address is already
there. In a group, `/split 30 dinner` asks everyone for their share.

## Request

`/request 20 lunch` posts a card asking the other person to pay you. They tap
it, review, confirm; you see the payment arrive. The request carries your
address for the chain, so it works across networks.

## Watch an address

`/watch vitalik.eth` keeps an eye on an address without owning it. When its
balance moves, the Wallet room posts a card: how much, the new balance, and a
button to the explorer. Your own address is always watched.

## Connect a site

The **Browser** plugin opens dapps in your system browser and connects them
back to this wallet over WalletConnect. `/open uniswap` opens a bookmark;
`/scan` reads a WalletConnect code; when the site asks for a signature, the
app shows a review sheet and signs only when you confirm. `/connected` lists
open sessions, `/disconnect` closes one, `/bookmark` adds a site of your own.

## Gas, explorer, your own node

`/gas` shows the current fee. `/explorer` opens an address on the chain's
block explorer. `/rpc https://…` points a chain at an endpoint you run or
pay for, if you would rather not use the public one. That endpoint sees the
addresses you look at, and the app says so.

::: tip Not a custodian
The app holds no funds, runs no exchange and takes no fee. Keys are made on
the device from your phrase and never transmitted; transactions go from the
device straight to a public endpoint.
:::
