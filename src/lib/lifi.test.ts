import { LIFI_NATIVE, LifiError, lifiQuote, lifiStatus, lifiToken } from './lifi';

const me = '0x0000000000000000000000000000000000000002' as const;
const probe = { txHash: '0xabc', fromChain: 1, toChain: 10 };

function stub(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), headers: (init as RequestInit | undefined)?.headers as Record<string, string> | undefined });
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('the LI.FI client', () => {
  it('sends the amount in base units, names the integrator and carries no header without a key', async () => {
    const calls = stub(200, {});

    await lifiQuote(
      {
        fromChain: 8453,
        toChain: 42161,
        fromToken: LIFI_NATIVE,
        toToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        fromAddress: me,
        toAddress: me,
        fromAmount: 10n ** 15n,
        slippage: 0.005,
      },
      null
    );

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('https://li.quest/v1/quote');
    expect(url.searchParams.get('fromAmount')).toBe('1000000000000000');
    expect(url.searchParams.get('integrator')).toBe('status-original');
    expect(url.searchParams.get('slippage')).toBe('0.005');
    // Where the bought token lands is always stated, never left to a default.
    expect(url.searchParams.get('toAddress')).toBe(me);
    expect(calls[0].headers).toBeUndefined();
  });

  it('puts a saved key in the x-lifi-api-key header', async () => {
    const calls = stub(200, {});

    await lifiStatus(probe, 'lifi_key');

    expect(calls[0].headers).toEqual({ 'x-lifi-api-key': 'lifi_key' });
    expect(new URL(calls[0].url).searchParams.get('txHash')).toBe('0xabc');
  });

  it('asks about a token once, whatever the case, and answers null for one LI.FI does not know', async () => {
    const calls = stub(200, { address: '0x1', chainId: 8453, symbol: 'USDC', decimals: 6 });

    const first = await lifiToken(8453, 'usdc', null);
    const second = await lifiToken(8453, 'USDC', null);

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);

    stub(400, { message: '/token Unknown token symbol', code: 1011 });
    expect(await lifiToken(8453, 'NOPE', null)).toBeNull();
  });

  it('turns rate limiting into advice about a key rather than a bare 429', async () => {
    stub(429, { message: 'Too many requests' });

    await expect(lifiStatus(probe, null)).rejects.toThrow(/own LI.FI key under Settings/);
  });

  it('says when the key was rejected', async () => {
    stub(401, { message: 'Unauthorized' });

    await expect(lifiStatus(probe, 'bad')).rejects.toThrow(/key was rejected/);
  });

  it('explains a missing route without the filtered-path dump', async () => {
    stub(404, { message: 'No available quotes for the requested transfer', code: 1002, errors: {} });

    const failure = lifiStatus(probe, null);
    await expect(failure).rejects.toBeInstanceOf(LifiError);
    await expect(failure).rejects.toThrow(/no route for this trade/);
  });

  it('passes other LI.FI messages through', async () => {
    stub(400, { message: 'Token 1-0xabc is invalid or in deny list.', code: 1011 });

    await expect(lifiStatus(probe, null)).rejects.toThrow(/deny list/);
  });
});
