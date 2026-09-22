import { formatEther, parseEther, type Address } from 'viem';

import { shortAddress } from '@/core/identity/keyring';
import { isLocalConversation } from '@/core/messaging/bots';
import type {
  CommandInvocation,
  CommandResult,
  PluginContext,
  SlashCommand,
} from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { chainFromArgs, chainSlug, SUPPORTED_CHAINS, trimDecimals } from '@/lib/evm/chains';
import {
  CONTENT_TYPE_PAYMENT_SPLIT,
  CONTENT_TYPE_PAYMENT_REQUEST,
  type PaymentRequest,
  type SplitRequest,
} from './types';
import {
  chainStrategies,
  selfAddressOf,
  targetAddress,
  type AddressLookup,
  type ChainStrategy,
} from './chains/strategy';
import { chainFlag, NO_NETWORK_ON, pickSendable, pickStrategy, withoutChain } from './networks';
import { walletErrorMessage } from './errors';
import { commitTransfer } from './transfer';

type Respond = CommandInvocation['respond'];

function chainOptions(chains: ChainStrategy[]) {
  return chains.map((c) => ({ label: c.name, value: c.id }));
}

function tokenOptions(chains: ChainStrategy[]) {
  return chains.map((c) => ({
    label: c.transfer!.symbol,
    value: c.transfer!.symbol,
    when: { chain: c.id },
  }));
}

function tokenMismatch(chain: ChainStrategy, token: string | undefined): string | null {
  if (!token || token.toUpperCase() === chain.transfer!.symbol.toUpperCase()) return null;
  return `${chain.name} sends ${chain.transfer!.symbol}, not ${token}.`;
}

export const withoutConfirm = (rest: string[]) => rest.filter((a) => a !== '--confirm');

/**
 * What a form can offer to send: each network's coin, then the tokens held
 * there. An option follows the form field `networkField` names.
 */
export async function assetField(chains: ChainStrategy[], context: PluginContext, networkField: string) {
  const assets = await Promise.all(
    chains.map(async (c) => ({
      chain: c,
      extra: (await c.transfer!.assets?.(context).catch(() => [])) ?? [],
    }))
  );
  return {
    options: assets.flatMap(({ chain: c, extra }) => [
      { label: c.transfer!.symbol, value: 'native', when: { [networkField]: c.id } },
      ...extra.map((a) => ({ label: a.symbol, value: a.id, when: { [networkField]: c.id } })),
    ]),
    /** The held token `given` names on `chainId`, by id or symbol. */
    held: (chainId: string, given: string | undefined) => {
      const wanted = given?.toLowerCase();
      return assets
        .find((a) => a.chain.id === chainId)
        ?.extra.find((a) => a.id.toLowerCase() === wanted || a.symbol.toLowerCase() === wanted);
    },
  };
}

/** `/send 0.1 0x…` in full, or just `/send 0x…` to fill the recipient and ask for the rest. */
function sendPositionals(rest: string[]): { amount?: string; recipient?: string } {
  const [first, second] = withoutConfirm(rest);
  if (first !== undefined && second === undefined && !/^\d*\.?\d+$/.test(first)) {
    return { recipient: first };
  }
  return { amount: first, recipient: second };
}

async function balanceDetail(
  chain: ChainStrategy,
  given: string | undefined,
  context: PluginContext,
  respond: Respond
): Promise<CommandResult> {
  const blocked = chain.unavailable?.(context) ?? null;
  if (blocked) return blocked;

  let target: AddressLookup;
  try {
    target = await targetAddress(chain, context, given, { resolve: true });
  } catch (error) {
    return { type: 'error', message: walletErrorMessage(error, chain, 'balance') };
  }
  if ('error' in target) return { type: 'error', message: target.error };
  const { address } = target;

  try {
    const amount = (await chain.balance?.(context, address)) ?? '—';
    const symbol = chain.transfer?.symbol ?? '';
    const detail = (await chain.detail?.(context, address)) ?? [];

    await respond({
      kind: 'widget',
      fallback: `${amount} ${symbol} on ${chain.name}`,
      widget: W.card(
        [
          W.stat(`${amount} ${symbol}`.trim(), {
            label: given ? shortAddress(address) : 'Your balance',
            caption: chain.name,
            actions: chain.transfer
              ? [{ label: `Send ${symbol}`, command: `/draft /send  --chain ${chain.id}` }]
              : undefined,
          }),
          ...detail,
          W.link(
            `View on ${chain.explorer.name}`,
            chain.explorer.addressUrl(address),
            'open-outline'
          ),
        ],
        { title: chain.name, icon: chain.icon }
      ),
    });
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: walletErrorMessage(error, chain, 'balance') };
  }
}

async function balanceOverview(
  chains: ChainStrategy[],
  context: PluginContext,
  respond: Respond
): Promise<CommandResult> {
  const readings = await Promise.all(
    chains.map(async (chain) => {
      try {
        if (chain.unavailable?.(context)) return { chain, amount: null };
        const address = chain.selfAddress(context);
        return { chain, amount: (await chain.balance?.(context, address)) ?? null };
      } catch {
        return { chain, amount: null };
      }
    })
  );

  await respond({
    kind: 'widget',
    fallback: readings
      .map((r) => `${r.chain.name} ${r.amount ?? 'unavailable'}`)
      .join(' · '),
    widget: W.card(
      [
        W.rows(
          readings.map((r) => ({
            label: r.chain.name,
            value:
              r.amount === null
                ? 'unavailable'
                : `${r.amount} ${r.chain.transfer?.symbol ?? ''}`.trim(),
            tone: r.amount === null ? ('warning' as const) : undefined,
            actions:
              r.amount === null
                ? [{ label: 'Why unavailable?', command: `/balance --chain ${r.chain.id}` }]
                : [
                    { label: 'Detail', command: `/balance --chain ${r.chain.id}` },
                    ...(r.chain.transfer
                      ? [
                          {
                            label: `Send ${r.chain.transfer.symbol}`,
                            command: `/draft /send  --chain ${r.chain.id}`,
                          },
                        ]
                      : []),
                  ],
          }))
        ),
        W.text('Only the networks you have switched on. /networks changes that.'),
      ],
      { title: 'Balances', icon: 'wallet-outline' }
    ),
  });
  return { type: 'handled' };
}

export const walletCommands: SlashCommand[] = [

  {
    name: 'balance',
    aliases: ['bal'],
    description: 'What you hold, across every network by default',
    showIn: ['dm', 'group', 'channel'],
    usage: '/balance [address] [--chain bitcoin]',
    async run({ args, context, respond }) {
      const chains = chainStrategies();
      if (chains.length === 0) return { type: 'error', message: NO_NETWORK_ON };

      const named = chainFlag(args);
      if (!named) return balanceOverview(chains, context, respond);

      const picked = pickStrategy(chains, named);
      if ('error' in picked) return { type: 'error', message: picked.error };
      return balanceDetail(picked.chain, withoutChain(args)[0], context, respond);
    },
  },

  {
    name: 'send',
    aliases: ['pay'],
    description: "Send a coin or a token to an address",
    showIn: ['dm', 'group', 'channel'],
    usage: '/send <amount> <address | name.eth> [--chain bitcoin] [--token USDC]',
    async run({ args, context, respond }) {
      const picked = await pickSendable(context, args, (rest) => sendPositionals(rest).recipient);
      if ('error' in picked) return { type: 'error', message: picked.error };
      const { chain, chains, token, rest } = picked;

      const confirmed = rest.includes('--confirm');
      const { amount, recipient } = sendPositionals(rest);

      if (!amount || !recipient) {
        const assets = await assetField(chains, context, 'chain');

        await respond({
          kind: 'widget',
          fallback: `Send on ${chain.name}`,
          widget: W.card(
            [
              W.form(
                [
                  {
                    id: 'chain',
                    label: 'Network',
                    value: chain.id,
                    options: chainOptions(chains),
                  },
                  {
                    id: 'token',
                    label: 'Asset',
                    value: assets.held(chain.id, token)?.id ?? 'native',
                    options: assets.options,
                  },
                  {
                    id: 'amount',
                    label: 'Amount in {token}',
                    placeholder: '0.01',
                    keyboard: 'decimal',
                    value: amount ?? '',
                  },
                  {
                    id: 'to',
                    label: 'To',
                    placeholder: '{chain} address',
                    value: recipient ?? '',
                  },
                ],
                { label: 'Review', command: '/send {amount} {to} --chain {chain} --token {token}' }
              ),
              W.text(
                `Changing the network re-prices the transfer. ${chain.name} sends from your ` +
                  `${chain.name} address, which is not the same address on every network.`
              ),
            ],
            { title: `Send on ${chain.name}`, icon: 'arrow-up-circle-outline' }
          ),
        });
        return { type: 'handled' };
      }

      const asset = token && token !== 'native' ? token : undefined;
      const params = { amount, to: recipient, asset };

      try {
        const quote = await chain.transfer!.quote(context, params);
        if ('error' in quote) return { type: 'error', message: `${quote.error} Nothing was sent.` };
        const { symbol } = quote;

        if (!confirmed) {
          await respond({
            kind: 'widget',
            fallback: `Send ${amount} ${symbol} to ${recipient}?`,
            widget: W.card(
              [
                W.stat(`${amount} ${symbol}`, { label: `To ${recipient}`, tone: 'brand' }),
                W.rows(quote.rows),
                W.actions([
                  {
                    label: 'Confirm and send',
                    command:
                      `/send ${amount} ${recipient} --chain ${chain.id}` +
                      `${asset ? ` --token ${asset}` : ''} --confirm`,
                  },
                ]),
                W.text('Nothing is signed until you confirm.'),
              ],
              { title: 'Review transfer', icon: 'arrow-up-circle-outline', tone: 'brand' }
            ),
          });
          return { type: 'handled' };
        }

        const sent = await commitTransfer(chain, context, params, {
          onSent: (id) =>
            respond({
              kind: 'widget',
              fallback: `Sent ${amount} ${symbol} to ${recipient}`,
              widget: W.card(
                [
                  W.stat(`${amount} ${symbol}`, { label: `Sent to ${recipient}`, tone: 'success' }),
                  W.code(id, { label: 'Transaction' }),
                  W.link(`View on ${chain.explorer.name}`, chain.explorer.addressUrl(recipient)),
                ],
                { title: 'Sent', icon: 'checkmark-circle', tone: 'success' }
              ),
            }),
        });
        return sent.ok ? { type: 'handled' } : { type: 'error', message: sent.message };
      } catch (error) {
        return { type: 'error', message: walletErrorMessage(error, chain, 'review') };
      }
    },
  },

  {
    name: 'request',
    aliases: ['req'],
    description: 'Ask for a payment: a card with a Pay button',
    showIn: ['dm', 'group'],
    usage: '/request <amount> [--chain bitcoin] [--token BTC] [note…]',
    async run({ args, conversationId, context, respond }) {
      const picked = await pickSendable(context, args);
      if ('error' in picked) return { type: 'error', message: picked.error };
      const { chain, chains, token, rest } = picked;
      const [amount, ...noteParts] = rest;

      const mismatch = tokenMismatch(chain, token);
      if (mismatch) return { type: 'error', message: mismatch };

      const symbol = chain.transfer!.symbol;

      if (!amount) {
        await respond({
          kind: 'widget',
          fallback: `Request ${symbol} on ${chain.name}`,
          widget: W.card(
            [
              W.form(
                [
                  {
                    id: 'chain',
                    label: 'Chain',
                    value: chain.id,
                    options: chainOptions(chains),
                  },
                  {
                    id: 'token',
                    label: 'Token',
                    value: symbol,
                    options: tokenOptions(chains),
                    hint: 'They pay into your {chain} address.',
                  },
                  {
                    id: 'amount',
                    label: 'Amount in {token}',
                    placeholder: '0.05',
                    keyboard: 'decimal',
                  },
                  {
                    id: 'note',
                    label: 'What for',
                    placeholder: 'coffee',
                    hint: 'Shown on the card they receive.',
                    optional: true,
                  },
                ],
                {
                  label: 'Send request',
                  command: '/request {amount} --chain {chain} --token {token} {note}',
                }
              ),
            ],
            { title: `Ask for ${symbol}`, icon: 'arrow-down-circle-outline' }
          ),
        });
        return { type: 'handled' };
      }

      if (!/^\d+(\.\d+)?$/.test(amount)) {
        return { type: 'error', message: `"${amount}" is not a valid amount.` };
      }

      if (isLocalConversation(conversationId)) {
        return {
          type: 'error',
          message: 'Payment requests need a real conversation. There is nobody to pay here.',
        };
      }

      const self = selfAddressOf(chain, context);
      if ('error' in self) return { type: 'error', message: self.error };

      const payload: PaymentRequest = {
        amount,
        symbol,
        chain: chain.id,
        to: self.address,
        note: noteParts.join(' ') || undefined,
      };

      await context.chat.sendCustom(conversationId, CONTENT_TYPE_PAYMENT_REQUEST, payload);
      return { type: 'handled' };
    },
  },

  {
    name: 'split',
    description: 'Ask everyone here for their share of a bill',
    usage: '/split <total> [--chain base] [note…]',
    showIn: ['group'],
    async run({ args, conversationId, context, respond }) {
      const { chain, rest } = chainFromArgs(args);
      const [total, ...noteParts] = rest;

      if (!total) {
        await respond({
          kind: 'widget',
          fallback: `Split a bill on ${chain.name}`,
          widget: W.card(
            [
              W.form(
                [
                  {
                    id: 'chain',
                    label: 'Chain',
                    value: chainSlug(chain.name),
                    options: SUPPORTED_CHAINS.map((c) => ({
                      label: c.name,
                      value: chainSlug(c.name),
                    })),
                  },
                  {
                    id: 'token',
                    label: 'Token',
                    value: chain.nativeCurrency.symbol,
                    options: SUPPORTED_CHAINS.map((c) => ({
                      label: c.nativeCurrency.symbol,
                      value: c.nativeCurrency.symbol,
                      when: { chain: chainSlug(c.name) },
                    })),
                  },
                  {
                    id: 'total',
                    label: 'Total in {token}',
                    placeholder: '0.32',
                    keyboard: 'decimal',
                  },
                  { id: 'note', label: 'What for', placeholder: 'dinner', optional: true },
                ],
                { label: 'Split it', command: '/split {total} --chain {chain} {note}' }
              ),
            ],
            { title: 'Split a bill', icon: 'people-outline' }
          ),
        });
        return { type: 'handled' };
      }

      let totalWei: bigint;
      try {
        totalWei = parseEther(total);
      } catch {
        return { type: 'error', message: `"${total}" is not a valid amount.` };
      }

      const members = await context.chat.members(conversationId);
      if (members.length < 2) {
        return { type: 'error', message: 'Nobody to split with. /split works in a group.' };
      }

      const share = trimDecimals(formatEther(totalWei / BigInt(members.length)));
      const note = noteParts.join(' ').trim();

      const payload: SplitRequest = {
        total,
        share,
        people: members.length,
        symbol: chain.nativeCurrency.symbol,
        chainId: chain.id,
        to: context.identity.address as Address,
        ...(note ? { note } : {}),
      };

      await context.chat.sendCustom(conversationId, CONTENT_TYPE_PAYMENT_SPLIT, payload);
      return { type: 'handled' };
    },
  },

];
