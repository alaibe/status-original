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

Token balances come from a list of about 830 tokens that ships with the app,
the Uniswap Labs Default list from [tokenlists.org](https://tokenlists.org).
The app asks each of those contracts what you hold, in one batched call to the
same endpoint it already uses for everything else, so nothing about your
addresses reaches a third party and there is no key to enter.

`/tokens` says how many are watched on a network. A token the list does not
carry is `/tokens add <contract address>`: the app reads its symbol and
decimals from the contract and watches it from then on, and `/tokens remove`
drops it again.

Solana needs none of that. One call to the same endpoint returns every token
the address holds, with the amount, so `/balance --chain solana` lists them
all. A second bundled list, Jupiter's verified one, only puts a name to a
mint; anything it does not know shows its mint address instead. Sending a
Solana token is not in yet, only SOL itself.

## Send

`/send 0.01 vitalik.eth` (or just `/send`, and fill in the form). Pick the
network and the asset, enter the amount and who to, and tap **Review**. The
review shows exactly what will be signed (amount, recipient, fee), and
nothing is signed until you confirm. Hardware accounts confirm on the
device.

Sending in a chat with the person is the natural way: the address is already
there. In a group, `/split 30 dinner` asks everyone for their share.

## Swap and bridge

`/trade 25 usdc eth` quotes a swap and shows what you would get for it.
`/swap` and `/bridge` are the same command under other names. It works
between the EVM networks you have switched on, so Ethereum, Base, Optimism,
Arbitrum and Polygon; Bitcoin and Solana are not part of it.

Stay on one network for a swap, or add `--from base --to arbitrum` to move a
token across. `/trade` on its own opens a form with the networks, the assets
you hold and the amount.

The review card says how much you receive, the least you would accept if the
price moves (0.5% slippage), which route it takes, how long that route
usually needs, and the network and route fees. The quote is taken again when
you confirm, so the amount can move a little with the market, and nothing is
signed until then.

Letting the router take the token costs no transaction in most cases. A token
that understands `permit` (USDC and many newer ones) is released by a
signature made on your device, for that amount and half an hour only. Any
other token goes through Uniswap's Permit2, which needs one approval the
first time you trade it and never again; after that each trade is a signature
too. The card says which of the three applies before you confirm, and an
approval that is needed appears as its own message with a link to follow it.

A trade lands in your own address, which is the same address on every EVM
network. To send the result somewhere else, fill in **Recipient** on the form
or add `--recipient 0x…` (an ENS name works too). The review then says where
it lands, and nothing about it is guessed: the address is sent with the quote
rather than left to a default.

A bridge takes a few minutes to arrive. The card that confirms it has a
**Check status** button, and the same question later is
`/trade --status <transaction> --from base --to arbitrum`. Both say how far
along it is and link to the transaction on each side.

Quotes come from [LI.FI](https://li.fi), which sees the address, the tokens
and the amount you ask about. No key is needed: it allows this device about
75 quotes every two hours. Your own key, entered under Settings →
**Trades**, raises that to 100 a minute. As with every other key, none ships
with the app.

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
