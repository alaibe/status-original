#!/usr/bin/env node
// Rebuilds src/plugins/wallet/solana/token-list.json from Jupiter's verified
// list, trimmed to the most held tokens.
//
//   node scripts/fetch-solana-tokens.js
//
// Solana needs no list to find what an address holds: one RPC call returns
// every token account with its mint, decimals and balance. This list only puts
// a name to a mint, so a cap costs nothing but a shortened address for the
// long tail.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'https://lite-api.jup.ag/tokens/v2/tag?query=verified';
const KEEP = 1500;
const OUT = path.join(__dirname, '..', 'src', 'plugins', 'wallet', 'solana', 'token-list.json');

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`Jupiter answered ${response.status}`);
  const all = await response.json();

  const tokens = all
    .filter((token) => token.isVerified && token.id && token.symbol)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
    .slice(0, KEEP)
    .map((token) => [token.id, token.symbol, token.name ?? token.symbol])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const out = {
    source: 'https://jup.ag',
    name: 'Jupiter verified',
    fetched: new Date().toISOString().slice(0, 10),
    tokens,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`);
  console.log(
    `${out.name}: ${tokens.length} of ${all.length} → ${path.relative(process.cwd(), OUT)} ` +
      `(${fs.statSync(OUT).size} bytes)`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
