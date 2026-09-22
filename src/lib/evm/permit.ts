import {
  encodeFunctionData,
  erc20Abi,
  domainSeparator,
  maxUint256,
  parseAbi,
  parseSignature,
  type Address,
  type Hex,
  type LocalAccount,
  type TypedDataDomain,
} from 'viem';

import { publicClientFor } from './chains';

/**
 * Signing away an allowance instead of sending one.
 *
 * A classic `approve` costs a transaction before every trade, and waiting for
 * it to be mined is the slowest, most failure-prone part of a swap. Both
 * permit standards replace it with an EIP-712 signature, which this app can
 * make on the device for nothing. LI.FI takes either through its Permit2Proxy:
 *
 *   eip2612  the token itself understands `permit`, so no allowance is ever
 *            needed. One transaction, no approval, ever.
 *   permit2  any ERC-20, once the account has approved the canonical Permit2
 *            contract. That approval happens once per token, to an immutable
 *            contract that can only move anything against a fresh signature
 *            naming the amount, the spender and a deadline.
 *
 * A trade with no plan at all falls back to a plain approval: a chain with no
 * proxy, or a signer that cannot sign typed data.
 */
export type PermitKind = 'eip2612' | 'permit2';

/** Canonical on most chains; LI.FI reports the exception per chain. */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

const MINUTES_VALID = 30;

const PROXY_ABI = parseAbi([
  'function nextNonce(address owner) view returns (uint256)',
  'function callDiamondWithPermit2(bytes diamondCalldata, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) external',
  'function callDiamondWithEIP2612Signature(address tokenAddress, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes diamondCalldata) external payable',
]);

const PERMIT_ABI = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);

const PERMIT2_TYPES = {
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const EIP2612_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface PermitTargets {
  /** The Permit2Proxy for this chain, from LI.FI's own chain list. */
  proxy: Address;
  permit2: Address;
}

export interface PermitPlan {
  kind: PermitKind;
  approve?: { spender: Address; amount: bigint };
}

const deadlineFromNow = () => BigInt(Math.floor(Date.now() / 1000) + MINUTES_VALID * 60);

export interface NativePermit {
  name: string;
  version: string;
  /** Read during the probe, and still current for the signature that follows. */
  nonce: bigint;
}

/** A token's name and version never change, so the answer is kept. */
const probed = new Map<string, Promise<Omit<NativePermit, 'nonce'> | null>>();

/**
 * Checked by rebuilding the token's domain and comparing it with the separator
 * the token reports, so a token that disagrees gets no signature it would only
 * reject.
 */
export async function supportsEip2612(
  chainId: number,
  token: Address,
  owner: Address
): Promise<NativePermit | null> {
  const client = publicClientFor(chainId);
  const contract = { address: token, abi: PERMIT_ABI } as const;
  const key = `${chainId}:${token.toLowerCase()}`;

  const read = <T>(call: Promise<T>) => call.catch(() => null);

  const nonce = await read(
    client.readContract({ ...contract, functionName: 'nonces', args: [owner] })
  );
  if (nonce === null) return null;

  probed.get(key) ??
    probed.set(
      key,
      (async () => {
        const [separator, name, reported] = await Promise.all([
          read(
            client.readContract({
              ...contract,
              functionName: 'DOMAIN_SEPARATOR',
            })
          ),
          read(client.readContract({ ...contract, functionName: 'name' })),
          read(client.readContract({ ...contract, functionName: 'version' })),
        ]);
        if (separator === null || name === null) return null;

        for (const version of reported ? [reported] : ['1', '2']) {
          const domain: TypedDataDomain = {
            name,
            version,
            chainId,
            verifyingContract: token,
          };
          if (domainSeparator({ domain }) === separator) return { name, version };
        }
        return null;
      })()
    );

  const domain = await probed.get(key)!;
  return domain && { ...domain, nonce };
}

/** Forgets the probes, for tests that change what a token answers. */
export function clearPermitCache(): void {
  probed.clear();
}

async function permit2Allowance(
  chainId: number,
  token: Address,
  owner: Address,
  permit2: Address
): Promise<bigint> {
  return publicClientFor(chainId).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, permit2],
  });
}

/**
 * Which lane a trade can take. `permit2` is preferred over an approval per
 * trade, and the one-off approval it may need is to Permit2, never to the
 * router itself.
 */
export async function planPermit(
  chainId: number,
  token: Address,
  owner: Address,
  amount: bigint,
  targets: PermitTargets | null,
  { canSignTypedData = true }: { canSignTypedData?: boolean } = {}
): Promise<PermitPlan | null> {
  if (!targets || !canSignTypedData) return null;

  const native = await supportsEip2612(chainId, token, owner).catch(() => null);
  if (native) return { kind: 'eip2612' };

  const allowed = await permit2Allowance(chainId, token, owner, targets.permit2);
  return {
    kind: 'permit2',
    ...(allowed < amount && {
      approve: { spender: targets.permit2, amount: maxUint256 },
    }),
  };
}

/** The transaction that puts a trade through the proxy with a signature. */
export async function permittedCall(
  chainId: number,
  account: LocalAccount,
  targets: PermitTargets,
  plan: PermitPlan,
  { token, amount, diamondCalldata }: { token: Address; amount: bigint; diamondCalldata: Hex }
): Promise<{ to: Address; data: Hex }> {
  const client = publicClientFor(chainId);
  const deadline = deadlineFromNow();

  if (plan.kind === 'eip2612') {
    const supported = await supportsEip2612(chainId, token, account.address);
    if (!supported) throw new Error('That token stopped answering as a permit token.');

    const { nonce, ...domain } = supported;

    const signature = await account.signTypedData({
      domain: { ...domain, chainId, verifyingContract: token },
      types: EIP2612_TYPES,
      primaryType: 'Permit',
      message: {
        owner: account.address,
        spender: targets.proxy,
        value: amount,
        nonce,
        deadline,
      },
    });

    const { r, s, yParity } = parseSignature(signature);
    return {
      to: targets.proxy,
      data: encodeFunctionData({
        abi: PROXY_ABI,
        functionName: 'callDiamondWithEIP2612Signature',
        args: [token, amount, deadline, yParity + 27, r, s, diamondCalldata],
      }),
    };
  }

  const nonce = await client.readContract({
    address: targets.proxy,
    abi: PROXY_ABI,
    functionName: 'nextNonce',
    args: [account.address],
  });

  const signature = await account.signTypedData({
    domain: { name: 'Permit2', chainId, verifyingContract: targets.permit2 },
    types: PERMIT2_TYPES,
    primaryType: 'PermitTransferFrom',
    message: {
      permitted: { token, amount },
      spender: targets.proxy,
      nonce,
      deadline,
    },
  });

  return {
    to: targets.proxy,
    data: encodeFunctionData({
      abi: PROXY_ABI,
      functionName: 'callDiamondWithPermit2',
      args: [diamondCalldata, { permitted: { token, amount }, nonce, deadline }, signature],
    }),
  };
}
