import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Chain, type Hex } from 'viem';

import { flagValue, withoutFlag } from '@/core/commands/flags';
import { loadTradeKey } from '@/core/identity/trade-key';
import type { CommandInvocation, CommandResult, PluginContext, SlashCommand } from '@/core/plugins/types';
import { W, type Widget, type WidgetRow, type WidgetTone } from '@/design/widgets';
import { publicClientFor, trimDecimals } from '@/lib/evm/chains';
import { explorerUrlFor } from '@/lib/evm/transactions';
import { walletClientFor } from '@/lib/evm/wallet';
import {
  LIFI_NATIVE,
  LifiError,
  lifiExplorerUrl,
  lifiQuote,
  lifiStatus,
  lifiToken,
  type LifiQuote,
  type LifiStatus,
  type LifiStatusValue,
  type LifiToken,
} from '@/lib/lifi';

import { chainStrategies, sendableChains, type ChainStrategy } from './chains/strategy';
import { assetField, withoutConfirm } from './commands';
import { sentPaymentErrorMessage, walletErrorMessage } from './errors';
import { activeNetwork, defaultChain, networkById, NO_NETWORK_ON, pickStrategy } from './networks';

type Respond = CommandInvocation['respond'];

const SLIPPAGE = 0.005;

const POWERED_BY = W.link('Powered by LI.FI', 'https://li.fi');

type TradeChain = ChainStrategy & { evm: Chain };

/** LI.FI routes between EVM networks here; Bitcoin and Solana sit this one out. */
const tradeChains = () =>
  sendableChains().filter((c): c is TradeChain => c.evm !== undefined);

function chainNamed(chains: TradeChain[], named: string): TradeChain | { error: string } {
  const known = networkById(named);
  if (known && !known.evm) {
    return { error: `Trades run between EVM networks, and ${known.name} is not one.` };
  }
  const picked = pickStrategy(chains, named);
  return 'error' in picked ? picked : picked.chain;
}

const chainName = (chainId: number) =>
  chainStrategies().find((c) => c.evm?.id === chainId)?.name ?? `chain ${chainId}`;

const statusCommand = (hash: string, from: TradeChain, to: TradeChain) =>
  `/trade --status ${hash} --from ${from.id} --to ${to.id}`;

const amountOf = (units: string | bigint, token: LifiToken) =>
  trimDecimals(formatUnits(BigInt(units), token.decimals));

const usd = (value: string | undefined) =>
  value && Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : null;

function costLine(costs: LifiQuote['estimate']['gasCosts']): string | null {
  if (!costs?.length) return null;
  const byToken = new Map<string, { units: bigint; token: LifiToken }>();
  for (const cost of costs) {
    const entry = byToken.get(cost.token.symbol) ?? { units: 0n, token: cost.token };
    entry.units += BigInt(cost.amount);
    byToken.set(cost.token.symbol, entry);
  }
  const amounts = [...byToken.values()]
    .map(({ units, token }) => `${amountOf(units, token)} ${token.symbol}`)
    .join(' + ');
  const total = costs.reduce((sum, cost) => sum + Number(cost.amountUSD ?? NaN), 0);
  return Number.isFinite(total) ? `${amounts} (≈ $${total.toFixed(2)})` : amounts;
}

const duration = (seconds: number) =>
  seconds < 60 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.ceil(seconds / 60)} min`;

interface Given {
  amount?: string;
  token?: string;
  receive?: string;
}

async function tradeForm(
  chains: TradeChain[],
  from: TradeChain,
  to: TradeChain,
  given: Given,
  context: PluginContext,
  respond: Respond
): Promise<CommandResult> {
  const assets = await assetField(chains, context, 'from');
  const networks = chains.map((c) => ({ label: c.name, value: c.id }));

  await respond({
    kind: 'widget',
    fallback: `Trade on ${from.name}`,
    widget: W.card(
      [
        W.form(
          [
            { id: 'from', label: 'From', value: from.id, options: networks },
            {
              id: 'token',
              label: 'Asset',
              value: assets.held(from.id, given.token)?.id ?? 'native',
              options: assets.options,
            },
            {
              id: 'amount',
              label: 'Amount in {token}',
              placeholder: '0.01',
              keyboard: 'decimal',
              value: given.amount ?? '',
            },
            { id: 'to', label: 'To', value: to.id, options: networks },
            {
              id: 'receive',
              label: 'Receive',
              placeholder: 'USDC',
              value: given.receive ?? '',
              hint: 'A symbol or contract address on {to}.',
            },
          ],
          { label: 'Get a quote', command: '/trade {amount} {token} {receive} --from {from} --to {to}' }
        ),
        W.text(
          'The same network on both sides is a swap; different networks, a bridge. LI.FI finds ' +
            'the route and quotes it. Nothing is signed until you confirm the quote.'
        ),
        POWERED_BY,
      ],
      { title: 'Trade', icon: 'swap-horizontal-outline' }
    ),
  });
  return { type: 'handled' };
}

interface Trade {
  quote: LifiQuote;
  fromToken: LifiToken;
  toToken: LifiToken;
  needsApproval: boolean;
}

type Prepared = Trade | { error: string };

async function resolveToken(
  chain: TradeChain,
  given: string,
  key: string | null
): Promise<LifiToken | { error: string }> {
  if (given.toLowerCase() === 'native') {
    const { symbol, decimals } = chain.evm.nativeCurrency;
    return { address: LIFI_NATIVE, chainId: chain.evm.id, symbol, decimals };
  }
  const found = await lifiToken(chain.evm.id, given, key);
  return (
    found ?? {
      error: `"${given}" is not a token LI.FI knows on ${chain.name}. Use its symbol or contract address.`,
    }
  );
}

/**
 * Resolves both sides and quotes. The balance is read before the quote so a
 * short balance costs no request from LI.FI's small unauthenticated budget.
 */
async function prepare(
  context: PluginContext,
  from: TradeChain,
  to: TradeChain,
  { amount = '', token = '', receive = '' }: Given,
  key: string | null
): Promise<Prepared> {
  if (!/^\d*\.?\d+$/.test(amount)) return { error: `"${amount}" is not a valid amount.` };

  const [fromToken, toToken] = await Promise.all([
    resolveToken(from, token, key),
    resolveToken(to, receive, key),
  ]);
  if ('error' in fromToken) return fromToken;
  if ('error' in toToken) return toToken;

  const fromAmount = parseUnits(amount, fromToken.decimals);
  if (fromAmount <= 0n) return { error: 'The amount must be greater than 0.' };

  const address = context.identity.address;
  const client = publicClientFor(from.evm.id);
  const native = fromToken.address === LIFI_NATIVE;
  const symbol = fromToken.symbol;

  const held = native
    ? await client.getBalance({ address })
    : await client.readContract({
        address: fromToken.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
  if (held < fromAmount) {
    return {
      error:
        `Not enough ${symbol} on ${from.name}. You hold ${amountOf(held, fromToken)} ${symbol} and ` +
        `want to trade ${amount} ${symbol}. Lower the amount or add ${symbol} on ${from.name}.`,
    };
  }

  let quote: LifiQuote;
  try {
    quote = await lifiQuote(
      {
        fromChain: from.evm.id,
        toChain: to.evm.id,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAddress: address,
        fromAmount,
        slippage: SLIPPAGE,
      },
      key
    );
  } catch (error) {
    if (error instanceof LifiError) return { error: error.message };
    throw error;
  }

  if (native) {
    const gas = (quote.estimate.gasCosts ?? []).reduce((sum, cost) => sum + BigInt(cost.amount), 0n);
    if (held < fromAmount + gas) {
      return {
        error:
          `Not enough ${symbol} on ${from.name}. You hold ${amountOf(held, fromToken)} ${symbol} and ` +
          `this trade needs ${amount} ${symbol} plus about ${amountOf(gas, fromToken)} ${symbol} in fees. ` +
          `Lower the amount or add ${symbol} on ${from.name}.`,
      };
    }
    return { quote, fromToken, toToken, needsApproval: false };
  }

  const allowance = quote.estimate.skipApproval
    ? fromAmount
    : await client.readContract({
        address: fromToken.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, quote.estimate.approvalAddress],
      });
  return { quote, fromToken, toToken, needsApproval: allowance < fromAmount };
}

function reviewCard(
  from: TradeChain,
  to: TradeChain,
  given: Given,
  { quote, fromToken, toToken, needsApproval }: Trade
): Widget {
  const { estimate } = quote;
  const same = from.id === to.id;
  const amount = amountOf(quote.action.fromAmount, fromToken);
  const [fromUsd, toUsd] = [usd(estimate.fromAmountUSD), usd(estimate.toAmountUSD)];
  const gas = costLine(estimate.gasCosts);
  const fees = costLine(estimate.feeCosts);

  const rows: WidgetRow[] = [
    { label: 'You send', value: `${amount} ${fromToken.symbol} on ${from.name}` },
    { label: 'Route', value: quote.toolDetails.name },
    { label: 'Takes about', value: duration(estimate.executionDuration) },
    ...(gas ? [{ label: 'Network fee', value: gas }] : []),
    ...(fees ? [{ label: 'Route fees', value: fees }] : []),
    ...(fromUsd && toUsd ? [{ label: 'Value', value: `${fromUsd} → ${toUsd}` }] : []),
  ];

  return W.card(
    [
      W.stat(`≈ ${amountOf(estimate.toAmount, toToken)} ${toToken.symbol}`, {
        label: `You receive on ${to.name}`,
        caption: `At least ${amountOf(estimate.toAmountMin, toToken)} ${toToken.symbol} after ${SLIPPAGE * 100}% slippage`,
        tone: 'brand',
      }),
      W.rows(rows),
      W.actions([
        {
          label: same ? 'Confirm and swap' : 'Confirm and bridge',
          command: `/trade ${given.amount} ${given.token} ${given.receive} --from ${from.id} --to ${to.id} --confirm`,
        },
      ]),
      W.text(
        'The quote is taken again when you confirm, so the amount can move a little with the ' +
          'market. Nothing is signed until then.' +
          (needsApproval
            ? ` ${fromToken.symbol} needs a one-time approval first: a second transaction on ${from.name} before the trade.`
            : '')
      ),
      POWERED_BY,
    ],
    {
      title: same ? `Swap on ${from.name}` : `Bridge ${from.name} → ${to.name}`,
      icon: 'swap-horizontal-outline',
      tone: 'brand',
    }
  );
}

/** Approves the route's contract when the allowance is short, then sends the quoted transaction. */
async function execute(
  context: PluginContext,
  from: TradeChain,
  { quote, fromToken, needsApproval }: Trade
): Promise<{ approval?: Hex; hash: Hex }> {
  const account = context.identity.account();
  const client = walletClientFor(account, from.evm.id);
  let approval: Hex | undefined;

  if (needsApproval) {
    approval = await client.sendTransaction({
      account,
      chain: null,
      to: fromToken.address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.estimate.approvalAddress, BigInt(quote.action.fromAmount)],
      }),
    });
    const receipt = await publicClientFor(from.evm.id).waitForTransactionReceipt({
      hash: approval,
      timeout: 120_000,
    });
    if (receipt.status === 'reverted') {
      throw new Error(`The ${fromToken.symbol} approval was rejected on ${from.name}. Nothing was traded.`);
    }
  }

  const tx = quote.transactionRequest;
  const hash = await client.sendTransaction({
    account,
    chain: null,
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : undefined,
    gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
  });
  return { approval, hash };
}

function sentCard(
  from: TradeChain,
  to: TradeChain,
  { quote, fromToken, toToken }: Trade,
  { approval, hash }: { approval?: Hex; hash: Hex }
): Widget {
  const same = from.id === to.id;
  const amount = amountOf(quote.action.fromAmount, fromToken);
  return W.card(
    [
      W.stat(`${amount} ${fromToken.symbol} → ≈ ${amountOf(quote.estimate.toAmount, toToken)} ${toToken.symbol}`, {
        label: same ? `Swapped on ${from.name}` : `Sent from ${from.name} to ${to.name}`,
        tone: 'success',
      }),
      ...(approval ? [W.code(approval, { label: 'Approval' })] : []),
      W.code(hash, { label: 'Transaction' }),
      W.link(`View on ${from.explorer.name}`, explorerUrlFor(from.evm.id, hash) ?? lifiExplorerUrl(hash)),
      W.link('Track on LI.FI', lifiExplorerUrl(hash)),
      ...(same
        ? []
        : [
            W.actions([{ label: 'Check status', command: statusCommand(hash, from, to) }]),
            W.text('Bridges take a few minutes. Check status asks LI.FI how far along it is.'),
          ]),
      POWERED_BY,
    ],
    { title: same ? 'Swapped' : 'Bridge started', icon: 'checkmark-circle', tone: 'success' }
  );
}

const STATUS_LABEL: Record<LifiStatusValue, { label: string; tone: WidgetTone }> = {
  DONE: { label: 'Done', tone: 'success' },
  PENDING: { label: 'In progress', tone: 'brand' },
  FAILED: { label: 'Failed', tone: 'danger' },
  NOT_FOUND: { label: 'Not seen yet', tone: 'warning' },
  INVALID: { label: 'Not recognised', tone: 'danger' },
};

async function statusCard(
  hash: string,
  from: TradeChain,
  to: TradeChain,
  key: string | null,
  respond: Respond
): Promise<CommandResult> {
  const status = await lifiStatus({ txHash: hash, fromChain: from.evm.id, toChain: to.evm.id }, key);
  const { label, tone } = STATUS_LABEL[status.status] ?? STATUS_LABEL.INVALID;
  const leg = (name: string, l: LifiStatus['sending']): WidgetRow[] =>
    l?.token && l.amount
      ? [{ label: name, value: `${amountOf(l.amount, l.token)} ${l.token.symbol} on ${chainName(l.chainId)}` }]
      : [];
  const open = status.status === 'PENDING' || status.status === 'NOT_FOUND';

  await respond({
    kind: 'widget',
    fallback: `Bridge ${label.toLowerCase()}`,
    widget: W.card(
      [
        W.stat(label, { label: `Bridge ${from.name} → ${to.name}`, caption: status.substatusMessage, tone }),
        W.rows([...leg('Sent', status.sending), ...leg('Received', status.receiving)]),
        ...(status.receiving?.txLink ? [W.link(`View on ${chainName(status.receiving.chainId)}`, status.receiving.txLink)] : []),
        W.link('Track on LI.FI', status.lifiExplorerLink ?? lifiExplorerUrl(hash)),
        ...(open ? [W.actions([{ label: 'Check again', command: statusCommand(hash, from, to) }])] : []),
        POWERED_BY,
      ],
      { title: 'Bridge status', icon: 'swap-horizontal-outline', tone }
    ),
  });
  return { type: 'handled' };
}

export const tradeCommand: SlashCommand = {
  name: 'trade',
  aliases: ['swap', 'bridge'],
  description: 'Swap a token, or bridge it to another network, through LI.FI',
  showIn: ['channel'],
  usage: '/trade <amount> <asset> <asset to receive> [--from base] [--to arbitrum]',
  async run({ args, context, respond }) {
    const chains = tradeChains();
    if (chains.length === 0) {
      return {
        type: 'error',
        message:
          sendableChains().length > 0
            ? 'Trades run between EVM networks, and none is switched on. /networks turns one on.'
            : NO_NETWORK_ON,
      };
    }

    const fromId = flagValue(args, '--from');
    const toId = flagValue(args, '--to');
    const status = flagValue(args, '--status');
    const confirmed = args.includes('--confirm');
    const [amount, token, receive] = withoutConfirm(
      ['--from', '--to', '--status'].reduce((rest, flag) => withoutFlag(rest, flag), args)
    );

    const from = fromId
      ? chainNamed(chains, fromId)
      : defaultChain(chains, undefined, (await activeNetwork(context))?.id);
    if ('error' in from) return { type: 'error', message: from.error };
    const to = toId ? chainNamed(chains, toId) : from;
    if ('error' in to) return { type: 'error', message: to.error };

    const given: Given = { amount, token, receive };
    if (!status && (!amount || !token || !receive)) {
      return tradeForm(chains, from, to, given, context, respond);
    }

    const accountId = context.identity.accountId;
    const key = accountId ? await loadTradeKey(accountId) : null;

    if (status) {
      try {
        return await statusCard(status, from, to, key, respond);
      } catch (error) {
        return {
          type: 'error',
          message: error instanceof LifiError ? error.message : walletErrorMessage(error, from, 'status'),
        };
      }
    }

    let prepared: Prepared;
    try {
      prepared = await prepare(context, from, to, given, key);
    } catch (error) {
      return { type: 'error', message: walletErrorMessage(error, from, 'quote') };
    }
    if ('error' in prepared) return { type: 'error', message: `${prepared.error} Nothing was sent.` };

    if (!confirmed) {
      await respond({
        kind: 'widget',
        fallback: `Trade ${amount} ${prepared.fromToken.symbol} for ${prepared.toToken.symbol}?`,
        widget: reviewCard(from, to, given, prepared),
      });
      return { type: 'handled' };
    }

    let sent: { approval?: Hex; hash: Hex } | undefined;
    try {
      sent = await execute(context, from, prepared);
      await respond({
        kind: 'widget',
        fallback: `Sent ${amount} ${prepared.fromToken.symbol} for ${prepared.toToken.symbol}`,
        widget: sentCard(from, to, prepared, sent),
      });
      return { type: 'handled' };
    } catch (error) {
      return {
        type: 'error',
        message: sent
          ? sentPaymentErrorMessage(from.name, sent.hash, 'trade')
          : walletErrorMessage(error, from, 'trade'),
      };
    }
  },
};
