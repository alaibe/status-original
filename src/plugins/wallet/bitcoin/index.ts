import type { PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { CoinType, looksLikeEnsName, resolveNameForCoin } from '@/lib/evm/ens';

import { BIP84_ACCOUNT_PATH, isBitcoinAddress, p2wpkhAddress } from './address';
import { broadcast, fetchAddressStats, fetchFeeRates, fetchUtxos, formatBtc } from './api';
import { apiBase, isDefaultApiBase, saveApiBase } from './config';
import { derivationUnavailable, type ChainStrategy } from '../chains/strategy';
import { planSpend } from './coins';
import { toHex } from '@/lib/bytes';

import { buildTransaction, scriptPubKey } from './transaction';
import { errorMessage } from '@/core/errors';

const EXPLORER = 'https://mempool.space';

const RECIPIENT_HINT =
  'Ask the recipient for their full Bitcoin mainnet address starting with bc1q; addresses starting with 1, 3, bc1p or tb1 are not supported for sending here.';

async function planTransfer(
  context: PluginContext,
  amount: string,
  to: string
): Promise<
  | { error: string }
  | {
      inputs: Awaited<ReturnType<typeof fetchUtxos>>;
      sending: bigint;
      change: bigint | null;
      fee: bigint;
      feeRate: number;
    }
> {
  if (!isBitcoinAddress(to)) {
    return { error: `"${to}" is not a supported Bitcoin recipient. ${RECIPIENT_HINT}` };
  }
  if (!/^\d+(\.\d{1,8})?$/.test(amount)) {
    return {
      error: `"${amount}" is not a valid BTC amount. Enter a number greater than 0 using up to 8 decimal places.`,
    };
  }

  const [whole, fraction = ''] = amount.split('.');
  const sats = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
  if (sats === 0n)
    return { error: 'Enter a BTC amount greater than 0, using up to 8 decimal places.' };

  try {
    scriptPubKey(to);
  } catch {
    return {
      error: `"${to}" cannot receive a Bitcoin payment from this wallet. ${RECIPIENT_HINT}`,
    };
  }

  const from = p2wpkhAddress(context.identity.derive(BIP84_ACCOUNT_PATH).publicKey);
  const [utxos, fees] = await Promise.all([fetchUtxos(from, apiBase()), fetchFeeRates(apiBase())]);

  const planned = planSpend(utxos, sats, fees.medium, { sendMax: false });
  if (!planned.ok) {
    if (fees.medium <= 0) {
      return {
        error:
          'The Bitcoin fee provider returned an invalid fee rate. Check your Bitcoin indexer setting or try reviewing again later.',
      };
    }
    const available = utxos.reduce((total, utxo) => total + utxo.value, 0n);
    return {
      error: `Not enough spendable BTC on Bitcoin. You have ${formatBtc(available)} BTC available and need ${formatBtc(sats)} BTC plus the network fee. Lower the amount to leave room for the fee, or add BTC to this wallet and wait for confirmation.`,
    };
  }

  return {
    inputs: planned.plan.inputs,
    sending: planned.plan.send,
    change: planned.plan.change,
    fee: planned.plan.fee,
    feeRate: fees.medium,
  };
}

export function bitcoinStrategy(context: PluginContext): ChainStrategy {
  return {
    id: 'bitcoin',
    name: 'Bitcoin',
    icon: 'logo-bitcoin',
    selfAddress: (ctx) => p2wpkhAddress(ctx.identity.derive(BIP84_ACCOUNT_PATH).publicKey),
    isAddress: isBitcoinAddress,
    addressHint: 'bc1…',
    // A name's *Bitcoin* record, per ENSIP-9. Reading its Ethereum record
    // instead would send bitcoin to an address nobody holds a key for.
    resolve: (input) =>
      looksLikeEnsName(input) ? resolveNameForCoin(input, CoinType.bitcoin) : Promise.resolve(null),
    unavailable: derivationUnavailable('Bitcoin'),

    async fees() {
      const rates = await fetchFeeRates(apiBase());
      return {
        headline: `${rates.medium} sat/vB`,
        label: 'Half-hour fee',
        caption: `≈ ${formatBtc(BigInt(rates.medium * 141))} BTC for a plain spend`,
        rows: [
          { label: 'Next block', value: `${rates.fast} sat/vB` },
          { label: 'Half an hour', value: `${rates.medium} sat/vB` },
          { label: 'An hour', value: `${rates.slow} sat/vB` },
        ],
        note:
          'Bitcoin charges for size, not computation, so what a spend costs depends on how ' +
          'many coins it has to gather.',
      };
    },

    async balance(_ctx, address) {
      return formatBtc((await fetchAddressStats(address, apiBase())).confirmed);
    },

    async detail(_ctx, address) {
      const stats = await fetchAddressStats(address, apiBase());
      return [
        W.rows([
          ...(stats.pending !== 0n
            ? [
                {
                  label: 'Pending',
                  value: `${formatBtc(stats.pending)} BTC in the mempool`,
                  tone: 'warning' as const,
                },
              ]
            : [
                {
                  label: 'Transactions',
                  value: String(stats.txCount),
                },
              ]),
          { label: 'Derivation', value: BIP84_ACCOUNT_PATH },
        ]),
        W.code(address, { label: 'Full address' }),
      ];
    },

    explorer: {
      name: 'mempool.space',
      addressUrl: (address) => `${EXPLORER}/address/${address}`,
      aliases: ['btcexplorer', 'mempool'],
    },
    transfer: {
      symbol: 'BTC',
      async quote(ctx, { amount, to }) {
        const plan = await planTransfer(ctx, amount, to);
        if ('error' in plan) return plan;
        const { sending, fee, change, feeRate, inputs } = plan;
        return {
          symbol: 'BTC',
          rows: [
            { label: 'Network', value: 'Bitcoin' },
            { label: 'Amount', value: `${formatBtc(sending)} BTC` },
            { label: 'Fee', value: `${formatBtc(fee)} BTC (${feeRate} sat/vB)` },
            {
              label: 'Change back',
              value: change === null ? 'none (it would be dust)' : `${formatBtc(change)} BTC`,
            },
            { label: 'Coins spent', value: String(inputs.length) },
          ],
        };
      },
      async commit(ctx, { amount, to }) {
        const plan = await planTransfer(ctx, amount, to);
        if ('error' in plan) throw new Error(plan.error);

        const key = ctx.identity.derive(BIP84_ACCOUNT_PATH);
        const from = p2wpkhAddress(key.publicKey);
        const outputs = [{ script: scriptPubKey(to), value: plan.sending }];
        if (plan.change !== null) {
          outputs.push({ script: scriptPubKey(from), value: plan.change });
        }
        const raw = buildTransaction(plan.inputs, outputs, key.privateKey, key.publicKey);
        return broadcast(toHex(raw), apiBase());
      },
    },

    endpoint: {
      current: async () => apiBase(),
      isDefault: isDefaultApiBase,
      set: (_ctx, url) => saveApiBase(context, url),
      check: async (url) => {
        try {
          await fetchAddressStats('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', url);
          return { ok: true as const };
        } catch (error) {
          return {
            ok: false as const,
            reason: errorMessage(error, 'That indexer did not answer.'),
          };
        }
      },
      noun: 'indexer',
      aliases: ['btcapi'],
    },
  };
}
