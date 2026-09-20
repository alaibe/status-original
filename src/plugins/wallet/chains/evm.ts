import type { Chain } from 'viem';
import { formatEther, formatGwei, parseEther } from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
} from 'viem/chains';

import { loadTokenKey } from '@/core/identity/token-key';
import type { PluginContext } from '@/core/plugins/types';
import type { IconName } from '@/design';
import { W } from '@/design/widgets';
import { publicClientFor, rpcOverrideFor, trimDecimals } from '@/lib/evm/chains';
import { looksLikeEnsName, resolveName } from '@/lib/evm/ens';
import {
  encodeTransfer,
  fetchTokens,
  supportsTokens,
  toTokenUnits,
  type TokenBalance,
} from '@/lib/evm/tokens';
import { estimateTransfer, sendNative, walletClientFor } from '@/lib/evm/wallet';

import { checkRpcUrl, saveRpcOverride } from './rpc';
import type { ChainStrategy } from './strategy';

export interface ChainSpec {
  id: string;
  name: string;
  chain: Chain;
  icon: IconName;
  description: string;
  rollup?: { bridge: string };
  /** A test network: its coin is free and worth nothing, and a balance card must say so. */
  testnet?: boolean;
}

export function explorerUrl(chain: Chain, address: string): string | null {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : null;
}

export async function tokensFor(
  chainId: number,
  address: `0x${string}`,
  context: PluginContext
): Promise<TokenBalance[]> {
  if (!supportsTokens(chainId)) return [];
  const accountId = context.identity.accountId;
  const key = accountId ? await loadTokenKey(accountId) : null;
  return key ? fetchTokens(chainId, address, key) : [];
}

async function tokenById(
  chainId: number,
  context: PluginContext,
  asset: string | undefined
): Promise<TokenBalance | undefined> {
  if (!asset || asset === 'native') return undefined;
  const address = context.identity.address as `0x${string}`;
  const tokens = await tokensFor(chainId, address, context);
  return tokens.find((t) => t.contract.toLowerCase() === asset.toLowerCase());
}

export function evmStrategy(spec: ChainSpec): ChainStrategy {
  const { chain } = spec;
  const native = chain.nativeCurrency.symbol;

  const badRecipient = (to: string) =>
    looksLikeEnsName(to)
      ? `No Ethereum address was found for "${to}" to use on ${chain.name}. Check the ENS name's spelling or paste the recipient's full 0x address.`
      : `"${to}" is not a valid recipient on ${chain.name}. Paste the full 0x address (40 characters after 0x) or enter an ENS name.`;
  const tokenNotFound = `The selected token could not be found on ${chain.name}. Check the network and token contract, then select the token again.`;

  return {
    id: spec.id,
    name: chain.name,
    icon: spec.icon,
    selfAddress: (context) => context.identity.address,
    isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
    addressHint: 'vitalik.eth or 0x…',
    resolve: (input) => (looksLikeEnsName(input) ? resolveName(input) : Promise.resolve(null)),

    async fees() {
      const client = publicClientFor(chain.id);
      const [estimate, block] = await Promise.all([
        client.estimateFeesPerGas(),
        client.getBlock(),
      ]);

      const perGas = estimate.maxFeePerGas ?? 0n;
      const transfer = perGas * 21_000n;

      return {
        headline: `${Number(formatGwei(perGas)).toFixed(4)} gwei`,
        label: 'Max fee per gas',
        caption: `≈ ${Number(formatEther(transfer)).toFixed(8)} ${native} for a plain transfer`,
        rows: [
          { label: 'Network', value: chain.name },
          { label: 'Block', value: block.number?.toString() ?? 'unknown' },
          {
            label: 'Priority fee',
            value: `${Number(formatGwei(estimate.maxPriorityFeePerGas ?? 0n)).toFixed(4)} gwei`,
          },
        ],
        ...(spec.rollup
          ? {
              note:
                'On an OP Stack chain the total is this plus an L1 data fee for posting the ' +
                'batch to Ethereum, which is usually the larger half and moves with L1 ' +
                'congestion.',
              link: { label: 'Bridge', url: spec.rollup.bridge },
            }
          : {}),
      };
    },

    async balance(_context, address) {
      const wei = await publicClientFor(chain.id).getBalance({
        address: address as `0x${string}`,
      });
      return trimDecimals(formatEther(wei));
    },

    async detail(context, address) {
      const tokens = await tokensFor(chain.id, address as `0x${string}`, context).catch(() => []);
      if (tokens.length === 0) return [];
      return [
        W.rows(
          tokens.map((token) => ({
            label: token.symbol,
            value: trimDecimals(token.amount),
            actions: [
              {
                label: `Send ${token.symbol}`,
                command: `/draft /send  --chain ${spec.id} --token ${token.contract}`,
              },
            ],
          }))
        ),
      ];
    },
    explorer: {
      name: chain.blockExplorers?.default.name ?? 'the explorer',
      addressUrl: (address) => explorerUrl(chain, address) ?? '',
    },
    transfer: {
      symbol: native,

      async assets(context) {
        const address = context.identity.address as `0x${string}`;
        const tokens = await tokensFor(chain.id, address, context).catch(() => []);
        return tokens.map((token) => ({
          symbol: token.symbol,
          id: token.contract,
          held: trimDecimals(token.amount),
        }));
      },

      async quote(context, { amount, to, asset }) {
        const [token, recipient] = await Promise.all([
          tokenById(chain.id, context, asset),
          resolveName(to),
        ]);
        if (asset && asset !== 'native' && !token) return { error: tokenNotFound };

        if (token) {
          let units: bigint;
          try {
            units = toTokenUnits(amount, token.decimals);
          } catch {
            return { error: `"${amount}" is not a valid ${token.symbol} amount. Enter a number greater than 0 using up to ${token.decimals} decimal places.` };
          }
          if (units > token.raw) {
            return {
              error: `Not enough ${token.symbol} on ${chain.name}. You hold ${trimDecimals(token.amount)} ${token.symbol} and want to send ${amount} ${token.symbol}. Lower the amount or add ${token.symbol} on ${chain.name}. Keep some ${native} for the network fee.`,
            };
          }
          if (!recipient) return { error: badRecipient(to) };
          return {
            symbol: token.symbol,
            rows: [
              { label: 'Network', value: chain.name },
              { label: 'Token', value: token.name },
              { label: 'Fee paid in', value: native },
              { label: 'To', value: recipient },
            ],
          };
        }

        try {
          parseEther(amount);
        } catch {
          return { error: `"${amount}" is not a valid ${native} amount. Enter a number greater than 0 using up to 18 decimal places.` };
        }

        if (!recipient) return { error: badRecipient(to) };

        const quoted = await estimateTransfer({
          account: context.identity.account(),
          chainId: chain.id,
          to: recipient,
          amount,
        });

        if (!quoted.sufficient) {
          return {
            error:
              `Not enough ${native} on ${chain.name}. You hold ` +
              `${trimDecimals(quoted.formatted.balance)} ${native} and this needs ${amount} ${native} plus about ` +
              `${trimDecimals(quoted.formatted.fee)} ${native} in fees. Lower the amount to leave room for the fee, or add ${native} on ${chain.name}.`,
          };
        }

        return {
          symbol: native,
          rows: [
            { label: 'Network', value: chain.name },
            { label: 'Est. fee', value: `${trimDecimals(quoted.formatted.fee)} ${native}` },
          ],
        };
      },
      async commit(context, { amount, to, asset }) {
        const [recipient, token] = await Promise.all([
          resolveName(to),
          tokenById(chain.id, context, asset),
        ]);
        if (!recipient) throw new Error(badRecipient(to));
        if (asset && asset !== 'native' && !token) throw new Error(tokenNotFound);
        if (token) {
          return walletClientFor(context.identity.account(), chain.id).sendTransaction({
            account: context.identity.account(),
            chain: null,
            to: token.contract,
            data: encodeTransfer(recipient, toTokenUnits(amount, token.decimals)),
            value: 0n,
          });
        }

        return sendNative({
          account: context.identity.account(),
          chainId: chain.id,
          to: recipient,
          amount,
        });
      },
    },

    endpoint: {
      current: async () => rpcOverrideFor(chain.id) ?? chain.rpcUrls.default.http[0],
      isDefault: (url) => url === chain.rpcUrls.default.http[0],
      set: (context, url) => saveRpcOverride(context, chain.id, url),
      check: (url) => checkRpcUrl(chain.id, url),
      noun: 'endpoint',
    },
  };
}

export const EVM_CHAINS: ChainSpec[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    chain: mainnet,
    icon: 'diamond-outline',
    description: 'Ethereum mainnet.',
  },
  {
    id: 'base',
    name: 'Base',
    chain: base,
    icon: 'ellipse-outline',
    description: 'Coinbase’s L2. Cheap, fast, EVM-identical.',
  },
  {
    id: 'optimism',
    name: 'Optimism',
    chain: optimism,
    icon: 'flash-outline',
    description: 'An optimistic rollup. Fees are L2 execution plus L1 data.',
    rollup: { bridge: 'https://superbridge.app/op-mainnet' },
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    chain: arbitrum,
    icon: 'triangle-outline',
    description: 'The largest optimistic rollup.',
    rollup: { bridge: 'https://bridge.arbitrum.io' },
  },
  {
    id: 'polygon',
    name: 'Polygon',
    chain: polygon,
    icon: 'shapes-outline',
    description: 'A sidechain with its own coin for fees.',
  },

  // Test networks sit in the same list as the rest, off until switched on,
  // instead of behind a "developer mode": the app has no separate build for
  // trying things out, and a faucet is how most people first send anything.
  {
    id: 'sepolia',
    name: 'Sepolia',
    chain: sepolia,
    icon: 'diamond-outline',
    description: 'Ethereum’s test network. Free coins from a faucet.',
    testnet: true,
  },
  {
    id: 'optimism-sepolia',
    name: 'Optimism Sepolia',
    chain: optimismSepolia,
    icon: 'flash-outline',
    description: 'Optimism, on test money.',
    rollup: { bridge: 'https://app.optimism.io/bridge' },
    testnet: true,
  },
  {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    chain: baseSepolia,
    icon: 'ellipse-outline',
    description: 'Base, on test money.',
    testnet: true,
  },
  {
    id: 'arbitrum-sepolia',
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    icon: 'triangle-outline',
    description: 'Arbitrum, on test money.',
    rollup: { bridge: 'https://bridge.arbitrum.io' },
    testnet: true,
  },
];
