import { isLocalConversation } from '@/core/messaging/bots';
import type { Plugin } from '@/core/plugins/types';
import { W, type Widget } from '@/design/widgets';
import {
  CoinType,
  looksLikeEnsName,
  lookupName,
  resolveName,
  resolveNameForCoin,
} from '@/lib/evm/ens';

export const profilePlugin: Plugin = {
  manifest: {
    id: 'profile',
    name: 'Names & addresses',
    description: 'Share your address in a chat, and look up what an ENS name points at.',
    version: '1.0.0',
    icon: 'person-circle-outline',
    permissions: ['identity.read', 'chat.read', 'chat.send', 'network'],
  },

  setup() {
    return {
      commands: [
        {
          name: 'address',
          aliases: ['myaddress'],
          description: 'Show or share your address',
          showIn: ['dm', 'group'],
          usage: '/address',
          async run({ conversationId, context, respond }) {
            const address = context.identity.address;

            if (isLocalConversation(conversationId)) {
              const name = await lookupName(address);
              await respond({
                kind: 'widget',
                fallback: `Your address: ${address}`,
                widget: W.card(
                  [
                    ...(name ? [W.stat(name, { label: 'Your ENS name' })] : []),
                    W.code(address, { label: 'Your address' }),
                    W.text('Anyone can message this address, or send to it.'),
                  ],
                  { title: 'Identity', icon: 'finger-print-outline' }
                ),
              });
              return { type: 'handled' };
            }

            await context.chat.sendText(conversationId, `My address: ${address}`);
            return { type: 'handled' };
          },
        },
        {
          name: 'ens',
          description: 'Look up an ENS name, including its Bitcoin record',
          showIn: ['dm', 'group'],
          usage: '/ens <name.eth>',
          async run({ args, respond }) {
            const [name] = args;
            if (!name) return { type: 'error', message: 'Which name? /ens vitalik.eth' };
            if (!looksLikeEnsName(name)) {
              return { type: 'error', message: `"${name}" does not look like an ENS name.` };
            }

            const [eth, btc] = await Promise.all([
              resolveName(name),
              resolveNameForCoin(name, CoinType.bitcoin),
            ]);

            if (!eth && !btc) {
              return { type: 'error', message: `${name} does not resolve to anything.` };
            }

            const children: Widget[] = [];
            if (eth) children.push(W.code(eth, { label: 'Ethereum' }));
            if (btc) children.push(W.code(btc, { label: 'Bitcoin' }));
            else {
              children.push(
                W.text(
                  'No Bitcoin record. ENS can hold one per ENSIP-9; this owner has not set it.'
                )
              );
            }
            if (eth) {
              children.push(
                W.actions([{ label: 'Balance', command: `/balance ${name} --chain ethereum` }])
              );
            }

            await respond({
              kind: 'widget',
              fallback: `${name} → ${eth ?? btc}`,
              widget: W.card(children, { title: name, icon: 'pricetag-outline' }),
            });
            return { type: 'handled' };
          },
        },
      ],
    };
  },
};
