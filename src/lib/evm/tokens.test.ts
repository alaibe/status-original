import { type Address } from 'viem';
import { base, mainnet } from 'viem/chains';

import { stubMulticall } from './testing/multicall';
import { listedToken, listedTokens, tokenList } from './token-list';
import {
  clearTokenCache,
  describeToken,
  encodeTransfer,
  fetchTokens,
  supportsTokens,
  toTokenUnits,
} from './tokens';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const HOLDER = '0x0000000000000000000000000000000000000001' as const;
const UNLISTED = '0x1111111111111111111111111111111111111111' as const;

beforeEach(clearTokenCache);

describe('the bundled token list', () => {
  it('covers the chains the wallet sends on', () => {
    expect(supportsTokens(mainnet.id)).toBe(true);
    expect(supportsTokens(base.id)).toBe(true);
    expect(supportsTokens(999_999)).toBe(false);
  });

  it('carries USDC on Base with six decimals', () => {
    const usdc = listedToken(base.id, USDC);
    expect(usdc?.symbol).toBe('USDC');
    expect(usdc?.decimals).toBe(6);
  });

  it('names where it came from, so the app can say so', () => {
    expect(tokenList().source).toBe('https://tokens.uniswap.org');
    expect(tokenList().count).toBe(
      [mainnet.id, base.id, 10, 137, 42161].reduce((sum, id) => sum + listedTokens(id).length, 0)
    );
  });

  it('holds no duplicate contract on a chain', () => {
    const seen = new Set(listedTokens(base.id).map((t) => t.address.toLowerCase()));
    expect(seen.size).toBe(listedTokens(base.id).length);
  });
});

describe('fetchTokens', () => {
  it('formats with the token’s own decimals, not 18', async () => {
    // 1 USDC is 1_000_000, because USDC has six. Formatting it with 18 would
    // report 0.000000000001, the kind of wrong that reads as "money gone".
    stubMulticall({ [USDC.toLowerCase()]: 1_000_000n });

    const held = await fetchTokens(base.id, HOLDER);
    const usdc = held.find((token) => token.symbol === 'USDC');

    expect(usdc?.decimals).toBe(6);
    expect(usdc?.amount).toBe('1');
    expect(usdc?.raw).toBe(1_000_000n);
  });

  it('keeps only what there is to spend', async () => {
    stubMulticall({});
    expect(await fetchTokens(base.id, HOLDER)).toEqual([]);
  });

  it('asks the chain itself, with no key and no third party', async () => {
    const calls = stubMulticall({ [USDC.toLowerCase()]: 1n });
    await fetchTokens(base.id, HOLDER);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((method) => method === 'eth_call')).toBe(true);
  });

  it('looks for a token the account added that the list does not carry', async () => {
    stubMulticall({ [UNLISTED.toLowerCase()]: 5n });

    const held = await fetchTokens(base.id, HOLDER, {
      extra: [
        {
          address: UNLISTED as Address,
          symbol: 'MINE',
          name: 'Mine',
          decimals: 0,
        },
      ],
    });

    expect(held.map((token) => token.symbol)).toEqual(['MINE']);
    expect(held[0].amount).toBe('5');
  });
});

describe('describeToken', () => {
  it('answers from the list without touching the network', async () => {
    const calls = stubMulticall({});
    const token = await describeToken(base.id, USDC);

    expect(token?.symbol).toBe('USDC');
    expect(calls).toHaveLength(0);
  });
});

describe('encodeTransfer', () => {
  it('is the ERC-20 transfer selector, then the arguments', () => {
    const data = encodeTransfer(HOLDER, 1_000_000n);
    // keccak("transfer(address,uint256)")[0..4]
    expect(data.slice(0, 10)).toBe('0xa9059cbb');
    expect(data).toHaveLength(2 + 8 + 64 + 64);
  });
});

describe('toTokenUnits', () => {
  it('uses the token’s decimals, so 1 USDC is not 1e18', () => {
    expect(toTokenUnits('1', 6)).toBe(1_000_000n);
    expect(toTokenUnits('1', 18)).toBe(10n ** 18n);
  });
});
