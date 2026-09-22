import { isAddress, type Address } from 'viem';

import { shortAddress } from '@/core/identity/keyring';
import type { SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';
import { listedTokens, tokenList } from '@/lib/evm/token-list';

import { addCustomToken, readCustomTokens, removeCustomToken } from './chains/token-storage';
import { pickEvm } from './networks';

export const tokensCommand: SlashCommand = {
  name: 'tokens',
  aliases: ['token'],
  showIn: ['channel'],
  description: 'The tokens the wallet looks for, and any you add yourself',
  usage: '/tokens [add <contract> | remove <contract>] [--chain base]',
  async run({ args, context, respond }) {
    const picked = await pickEvm(context, args);
    if ('error' in picked) return { type: 'error', message: picked.error };

    const { chain, networkId, rest } = picked;
    const [verb, given] = rest;

    if (verb && verb !== 'add' && verb !== 'remove') {
      return {
        type: 'error',
        message: 'Use /tokens add <contract> or /tokens remove <contract>.',
      };
    }

    if (verb) {
      if (!given || !isAddress(given)) {
        return {
          type: 'error',
          message: `"${given ?? ''}" is not a contract address on ${chain.name}.`,
        };
      }
      const contract = given as Address;

      if (verb === 'remove') {
        const gone = await removeCustomToken(context, chain.id, contract);
        return gone
          ? {
              type: 'notice',
              tone: 'success',
              message: `Removed from ${chain.name}`,
            }
          : {
              type: 'error',
              message: `That token was not one you added on ${chain.name}.`,
            };
      }

      const added = await addCustomToken(context, chain.id, contract);
      return added
        ? {
            type: 'notice',
            tone: 'success',
            message: `${added.symbol} is watched on ${chain.name}`,
          }
        : {
            type: 'error',
            message: `${shortAddress(contract)} does not answer as a token on ${chain.name}. Check the contract and the network.`,
          };
    }

    const custom = await readCustomTokens(context, chain.id);
    const bundled = tokenList();
    const listed = listedTokens(chain.id).length;

    await respond({
      kind: 'widget',
      fallback: `${listed} tokens watched on ${chain.name}`,
      widget: W.card(
        [
          W.stat(`${listed + custom.length}`, {
            label: `Tokens watched on ${chain.name}`,
            caption: `${bundled.name} v${bundled.version}${custom.length ? `, plus ${custom.length} of yours` : ''}`,
          }),
          ...(custom.length
            ? [
                W.rows(
                  custom.map((token) => ({
                    label: token.symbol,
                    value: shortAddress(token.address),
                    actions: [
                      {
                        label: 'Remove',
                        tone: 'danger' as const,
                        command: `/tokens remove ${token.address} --chain ${networkId}`,
                      },
                    ],
                  }))
                ),
              ]
            : []),
          W.text(
            'Add one the list misses with /tokens add <contract address>, and /tokens remove ' +
              'takes it back off.'
          ),
        ],
        { title: 'Tokens', icon: 'pricetag-outline' }
      ),
    });
    return { type: 'handled' };
  },
};
