import { fetchSplTokens } from './tokens';

const URL = 'https://rpc.example.invalid';
const OWNER = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const UNKNOWN = 'Mint1111111111111111111111111111111111111111';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

interface Held {
  mint: string;
  amount: string;
  decimals: number;
}

const account = ({ mint, amount, decimals }: Held) => ({
  account: {
    data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } },
  },
});

/** Answers getTokenAccountsByOwner per token program, and records what was asked. */
function stubRpc(byProgram: Record<string, Held[]>) {
  const asked: { method: string; programId?: string }[] = [];

  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const programId = body.params?.[1]?.programId as string | undefined;
    asked.push({ method: body.method, programId });

    const held = (programId && byProgram[programId]) || [];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: body.id,
        result: { value: held.map(account) },
      }),
    } as Response;
  }) as unknown as typeof fetch;

  return asked;
}

describe('fetchSplTokens', () => {
  it('asks both token programs, because 2022 mints live in their own', async () => {
    const asked = stubRpc({});
    await fetchSplTokens(URL, OWNER);

    expect(asked.map((a) => a.programId).sort()).toEqual([TOKEN, TOKEN_2022].sort());
    expect(asked.every((a) => a.method === 'getTokenAccountsByOwner')).toBe(true);
  });

  it('formats with the mint’s own decimals, which the chain reports', async () => {
    stubRpc({ [TOKEN]: [{ mint: USDC, amount: '1500000', decimals: 6 }] });

    const [token] = await fetchSplTokens(URL, OWNER);

    expect(token.amount).toBe('1.5');
    expect(token.decimals).toBe(6);
    expect(token.raw).toBe(1_500_000n);
  });

  it('adds up a mint held in more than one account', async () => {
    // A wallet can end up with several accounts for the same mint; showing one
    // of them would understate the balance.
    stubRpc({
      [TOKEN]: [
        { mint: USDC, amount: '1000000', decimals: 6 },
        { mint: USDC, amount: '500000', decimals: 6 },
      ],
    });

    const [token] = await fetchSplTokens(URL, OWNER);
    expect(token.amount).toBe('1.5');
  });

  it('drops emptied accounts, which Solana keeps around', async () => {
    stubRpc({ [TOKEN]: [{ mint: USDC, amount: '0', decimals: 6 }] });
    expect(await fetchSplTokens(URL, OWNER)).toEqual([]);
  });

  it('names a mint it knows and shortens one it does not', async () => {
    stubRpc({
      [TOKEN]: [{ mint: USDC, amount: '1', decimals: 0 }],
      [TOKEN_2022]: [{ mint: UNKNOWN, amount: '2', decimals: 0 }],
    });

    const [known, unknown] = await fetchSplTokens(URL, OWNER);

    expect(known.symbol).toBe('USDC');
    expect(known.listed).toBe(true);
    // Never a bare mint pretending to be a symbol, and never a guess.
    expect(unknown.symbol).toBe('Mint…1111');
    expect(unknown.name).toBe('Unknown token');
    expect(unknown.listed).toBe(false);
  });

  it('survives an endpoint that refuses one of the programs', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      if (body.params?.[1]?.programId === TOKEN_2022) return { ok: false, status: 500 } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            value: [account({ mint: USDC, amount: '1', decimals: 0 })],
          },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    expect((await fetchSplTokens(URL, OWNER)).map((t) => t.symbol)).toEqual(['USDC']);
  });
});
