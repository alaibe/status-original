import {
  decodeFunctionData,
  domainSeparator,
  parseAbi,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { base } from 'viem/chains';

import { publicClientFor } from './chains';
import { clearPermitCache, permittedCall, planPermit, supportsEip2612, PERMIT2 } from './permit';

jest.mock('./chains', () => ({
  ...jest.requireActual('./chains'),
  publicClientFor: jest.fn(),
}));

const OWNER = '0x0000000000000000000000000000000000000002' as Address;
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const PROXY = '0x89c6340B1a1f4b25D36cd8B063D49045caF3f818' as Address;
const CALLDATA = '0x4c279d6b' as Hex;
const SIGNATURE = `0x${'11'.repeat(32)}${'22'.repeat(32)}1c` as Hex;

const targets = { permit2: PERMIT2 as Address, proxy: PROXY };

const PROXY_ABI = parseAbi([
  'function callDiamondWithPermit2(bytes diamondCalldata, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) external',
  'function callDiamondWithEIP2612Signature(address tokenAddress, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes diamondCalldata) external payable',
]);

const domainOf = (name: string, version: string) =>
  domainSeparator({
    domain: { name, version, chainId: base.id, verifyingContract: TOKEN },
  });

interface Reads {
  nonces?: bigint;
  DOMAIN_SEPARATOR?: Hex;
  name?: string;
  version?: string;
  allowance?: bigint;
  nextNonce?: bigint;
}

function stubChain(reads: Reads) {
  jest.mocked(publicClientFor).mockReturnValue({
    readContract: async ({ functionName }: { functionName: keyof Reads }) => {
      const value = reads[functionName];
      if (value === undefined) throw new Error(`${functionName} is not a function`);
      return value;
    },
  } as never);
}

const signed: { typedData: unknown }[] = [];
const account = {
  address: OWNER,
  signTypedData: async (typedData: unknown) => {
    signed.push({ typedData });
    return SIGNATURE;
  },
} as unknown as LocalAccount;

beforeEach(() => {
  signed.length = 0;
  clearPermitCache();
  jest.clearAllMocks();
});

describe('detecting a token that signs its own permits', () => {
  it('accepts a token whose domain it can rebuild', async () => {
    stubChain({
      nonces: 0n,
      name: 'USD Coin',
      version: '2',
      DOMAIN_SEPARATOR: domainOf('USD Coin', '2'),
    });

    expect(await supportsEip2612(base.id, TOKEN, OWNER)).toEqual({
      name: 'USD Coin',
      version: '2',
      nonce: 0n,
    });
  });

  it('tries the usual versions when the token does not report one', async () => {
    stubChain({
      nonces: 0n,
      name: 'Token',
      DOMAIN_SEPARATOR: domainOf('Token', '2'),
    });

    expect(await supportsEip2612(base.id, TOKEN, OWNER)).toEqual({
      name: 'Token',
      version: '2',
      nonce: 0n,
    });
  });

  it('refuses a token whose separator does not match, rather than signing something it rejects', async () => {
    // A salt or a chainless domain lands here; a signature would be wasted gas.
    stubChain({
      nonces: 0n,
      name: 'Odd',
      version: '1',
      DOMAIN_SEPARATOR: `0x${'ab'.repeat(32)}`,
    });

    expect(await supportsEip2612(base.id, TOKEN, OWNER)).toBeNull();
  });

  it("reads a token's name and version once, not on every trade", async () => {
    // Immutable for the life of the contract, and re-read three times a trade
    // before this: plan, re-quote on confirm, then signing.
    let reads = 0;
    jest.mocked(publicClientFor).mockReturnValue({
      readContract: async ({ functionName }: { functionName: string }) => {
        reads += 1;
        if (functionName === 'nonces') return 4n;
        if (functionName === 'name') return 'USD Coin';
        if (functionName === 'version') return '2';
        return domainOf('USD Coin', '2');
      },
    } as never);

    const first = await supportsEip2612(base.id, TOKEN, OWNER);
    const after = reads;
    const second = await supportsEip2612(base.id, TOKEN, OWNER);

    expect(second).toEqual(first);
    // Only the nonce, which does move, is read again.
    expect(reads - after).toBe(1);
  });

  it('refuses a token with no permit at all, such as an old one', async () => {
    stubChain({ allowance: 0n });
    expect(await supportsEip2612(base.id, TOKEN, OWNER)).toBeNull();
  });
});

describe('choosing how a trade is allowed to take the token', () => {
  it('prefers the token’s own permit, which needs no allowance ever', async () => {
    stubChain({
      nonces: 0n,
      name: 'USD Coin',
      version: '2',
      DOMAIN_SEPARATOR: domainOf('USD Coin', '2'),
    });

    expect(await planPermit(base.id, TOKEN, OWNER, 5n, targets)).toEqual({
      kind: 'eip2612',
    });
  });

  it('uses Permit2 with no approval when the account has already allowed it', async () => {
    stubChain({ allowance: 10n });

    expect(await planPermit(base.id, TOKEN, OWNER, 5n, targets)).toEqual({
      kind: 'permit2',
    });
  });

  it('asks to approve Permit2, never the router, when the allowance is short', async () => {
    stubChain({ allowance: 0n });

    const plan = await planPermit(base.id, TOKEN, OWNER, 5n, targets);
    expect(plan?.approve?.spender).toBe(PERMIT2);
    expect(plan?.approve?.amount).toBe(2n ** 256n - 1n);
  });

  it('falls back to an approval where there is no proxy, or no typed data to sign', async () => {
    stubChain({ allowance: 10n });

    expect(await planPermit(base.id, TOKEN, OWNER, 5n, null)).toBeNull();
    expect(
      await planPermit(base.id, TOKEN, OWNER, 5n, targets, {
        canSignTypedData: false,
      })
    ).toBeNull();
  });
});

describe('the transaction a permit produces', () => {
  it('signs for the exact amount, names the proxy as spender, and expires', async () => {
    stubChain({ allowance: 10n, nextNonce: 7n });

    const call = await permittedCall(
      base.id,
      account,
      targets,
      { kind: 'permit2' },
      {
        token: TOKEN,
        amount: 5n,
        diamondCalldata: CALLDATA,
      }
    );

    const typed = signed[0].typedData as {
      domain: { name: string; verifyingContract: Address };
      message: {
        permitted: { amount: bigint };
        spender: Address;
        nonce: bigint;
        deadline: bigint;
      };
    };
    expect(typed.domain).toEqual(
      expect.objectContaining({ name: 'Permit2', verifyingContract: PERMIT2 })
    );
    expect(typed.message.permitted.amount).toBe(5n);
    expect(typed.message.spender).toBe(PROXY);
    expect(typed.message.nonce).toBe(7n);
    expect(typed.message.deadline).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));

    // It goes to the proxy, carrying the router's own calldata untouched.
    expect(call.to).toBe(PROXY);
    const { functionName, args } = decodeFunctionData({
      abi: PROXY_ABI,
      data: call.data,
    });
    expect(functionName).toBe('callDiamondWithPermit2');
    expect(args[0]).toBe(CALLDATA);
    expect(args[2]).toBe(SIGNATURE);
  });

  it('splits the signature for a token that takes v, r and s', async () => {
    stubChain({
      nonces: 3n,
      name: 'USD Coin',
      version: '2',
      DOMAIN_SEPARATOR: domainOf('USD Coin', '2'),
    });

    const call = await permittedCall(
      base.id,
      account,
      targets,
      { kind: 'eip2612' },
      {
        token: TOKEN,
        amount: 5n,
        diamondCalldata: CALLDATA,
      }
    );

    const { functionName, args } = decodeFunctionData({
      abi: PROXY_ABI,
      data: call.data,
    });
    expect(functionName).toBe('callDiamondWithEIP2612Signature');
    expect(args[0]).toBe(TOKEN);
    expect(args[1]).toBe(5n);
    expect(args[3]).toBe(28); // v, the 0x1c tail
    expect(args[4]).toBe(`0x${'11'.repeat(32)}`);
    expect(args[5]).toBe(`0x${'22'.repeat(32)}`);
    expect(args[6]).toBe(CALLDATA);
  });

  it('will not sign a token permit that stopped matching between the quote and the send', async () => {
    stubChain({
      nonces: 0n,
      name: 'Odd',
      version: '1',
      DOMAIN_SEPARATOR: `0x${'cd'.repeat(32)}`,
    });

    await expect(
      permittedCall(
        base.id,
        account,
        targets,
        { kind: 'eip2612' },
        {
          token: TOKEN,
          amount: 5n,
          diamondCalldata: CALLDATA,
        }
      )
    ).rejects.toThrow(/permit token/i);
    expect(signed).toHaveLength(0);
  });
});
