import { base, mainnet } from 'viem/chains';

import {
  alchemyUrl,
  clearTokenMeta,
  encodeTransfer,
  fetchTokens,
  primeTokenMeta,
  supportsTokens,
  toTokenUnits,
  tokenMetaFor,
} from './tokens';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const HOLDER = '0x0000000000000000000000000000000000000001' as const;

/** Counts calls so the caching claim is measured, not assumed. */
function stubAlchemy(balances: { contract: string; hex: string }[]) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    calls.push(body.method);

    if (body.method === 'alchemy_getTokenBalances') {
      return {
        ok: true,
        json: async () => ({
          result: {
            tokenBalances: balances.map((b) => ({
              contractAddress: b.contract,
              tokenBalance: b.hex,
            })),
          },
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ result: { name: 'USD Coin', symbol: 'USDC', decimals: 6 } }),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(clearTokenMeta);

describe('supportsTokens', () => {
  it('knows which chains are indexed', () => {
    expect(supportsTokens(mainnet.id)).toBe(true);
    expect(supportsTokens(base.id)).toBe(true);
    expect(supportsTokens(999_999)).toBe(false);
  });

  it('refuses to build a URL for a chain with no index', () => {
    expect(() => alchemyUrl(999_999, 'k')).toThrow(/no token index/);
  });
});

describe('fetchTokens', () => {
  it('formats with the token’s own decimals, not 18', async () => {
    // 1 USDC is 1_000_000, because USDC has six. Formatting it with 18 would
    // report 0.000000000001, the kind of wrong that reads as "money gone".
    stubAlchemy([{ contract: USDC, hex: '0xf4240' }]);

    const [token] = await fetchTokens(base.id, HOLDER, 'key');

    expect(token.decimals).toBe(6);
    expect(token.amount).toBe('1');
    expect(token.raw).toBe(1_000_000n);
  });

  it('skips tokens with a zero balance', async () => {
    stubAlchemy([{ contract: USDC, hex: '0x0' }]);
    expect(await fetchTokens(base.id, HOLDER, 'key')).toEqual([]);
  });

  it('fetches metadata once, then never again', async () => {
    const calls = stubAlchemy([{ contract: USDC, hex: '0xf4240' }]);

    await fetchTokens(base.id, HOLDER, 'key');
    expect(calls.filter((c) => c === 'alchemy_getTokenMetadata')).toHaveLength(1);

    await fetchTokens(base.id, HOLDER, 'key');
    await fetchTokens(base.id, HOLDER, 'key');
    // Name, symbol and decimals are fixed for the life of the contract, so a
    // refresh should cost one request in total rather than one per token.
    expect(calls.filter((c) => c === 'alchemy_getTokenMetadata')).toHaveLength(1);
    expect(calls.filter((c) => c === 'alchemy_getTokenBalances')).toHaveLength(3);
  });

  it('keeps the same contract on two chains apart', async () => {
    // An address is only unique within a chain; sharing an entry would let one
    // chain's decimals format another chain's balance.
    stubAlchemy([{ contract: USDC, hex: '0xf4240' }]);
    await fetchTokens(base.id, HOLDER, 'key');

    expect(Object.keys(tokenMetaFor(base.id))).toHaveLength(1);
    expect(Object.keys(tokenMetaFor(mainnet.id))).toHaveLength(0);
  });

  it('can be primed from storage, so a relaunch refetches nothing', async () => {
    primeTokenMeta(base.id, {
      [USDC.toLowerCase()]: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    });
    const calls = stubAlchemy([{ contract: USDC, hex: '0xf4240' }]);

    const [token] = await fetchTokens(base.id, HOLDER, 'key');

    expect(token.symbol).toBe('USDC');
    expect(calls.filter((c) => c === 'alchemy_getTokenMetadata')).toHaveLength(0);
  });

  it('says plainly when the key is rejected', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 }) as Response) as never;
    await expect(fetchTokens(base.id, HOLDER, 'bad')).rejects.toThrow(/rejected/);
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
    expect(toTokenUnits('1', 18)).toBe(1_000_000_000_000_000_000n);
    // Sending with the wrong decimals here is off by a factor of a trillion.
    expect(toTokenUnits('0.5', 6)).toBe(500_000n);
  });
});
