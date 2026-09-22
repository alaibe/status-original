#!/usr/bin/env node
// Rebuilds src/lib/evm/token-list.json from the Uniswap Labs Default list
// (https://tokenlists.org), trimmed to the chains the wallet sends on.
//
//   node scripts/fetch-token-list.js
//
// The list is bundled rather than fetched at runtime: it costs no request, it
// works offline, and nobody learns an address from it. Anything it misses is
// added in the app with /tokens add <contract>.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'https://tokens.uniswap.org';
const CHAINS = [1, 10, 137, 8453, 42161];
const OUT = path.join(__dirname, '..', 'src', 'lib', 'evm', 'token-list.json');

async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`);
  const list = await response.json();

  const tokens = {};
  for (const chainId of CHAINS) {
    const onChain = list.tokens
      .filter((token) => token.chainId === chainId)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((token) => [token.address, token.symbol, token.name, token.decimals]);
    if (onChain.length) tokens[chainId] = onChain;
  }

  const { major, minor, patch } = list.version;
  const out = {
    source: SOURCE,
    name: list.name,
    version: `${major}.${minor}.${patch}`,
    fetched: new Date().toISOString().slice(0, 10),
    tokens,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`);

  const counts = Object.entries(tokens).map(([chain, list]) => `${chain}: ${list.length}`);
  console.log(`${out.name} v${out.version} → ${path.relative(process.cwd(), OUT)}`);
  console.log(`${counts.join(', ')} (${fs.statSync(OUT).size} bytes)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
