import type { Bot, PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { walletConnectProjectId } from './config';
import { enabledDapps } from './dapps';

export const BROWSER_BOT_ID = 'dapps';

export function makeBrowserBot(context: PluginContext): Bot {
  return {
    id: BROWSER_BOT_ID,
    name: 'Dapps',
    tagline: 'Your wallet, in the browser',
    emoji: '🌐',

    greeting: () => [
      'Dapps open in your own browser and connect back to this wallet over WalletConnect, so your existing sessions and extensions keep working.',
      {
        kind: 'widget',
        fallback: '/dapps, /browse, /adddapp, /scan, /connect',
        widget: W.card(
          [
            W.list([
              {
                title: '/dapps',
                subtitle: 'The sites you can open, and which are switched on',
                actions: [{ label: 'Show them', command: '/dapps' }],
              },
              {
                title: '/browse uniswap',
                subtitle: 'Open one by name, or any address',
                actions: [{ label: 'Try it', command: '/draft /browse ' }],
              },
              {
                title: '/adddapp',
                subtitle: 'Add a site of your own',
                actions: [{ label: 'Add one', command: '/adddapp' }],
              },
              {
                title: '/scan',
                subtitle: 'Scan the code a site shows, and it can ask this wallet to sign',
                actions: [{ label: 'Scan a code', command: '/scan' }],
              },
              {
                title: '/connected',
                subtitle: 'Which sites are paired, and unpair one',
                actions: [{ label: 'Show them', command: '/connected' }],
              },
            ]),
            W.text(
              walletConnectProjectId()
                ? 'On the site choose Connect → WalletConnect, then scan its code with /scan or paste its pairing link with /connect wc:…. If the site is on this same phone, its "Open in app" button comes straight back here instead.'
                : 'Connecting is switched off: no WalletConnect project id is configured. Browsing still works; signing does not.'
            ),
          ],
          { title: 'Dapps', icon: 'compass-outline' }
        ),
      },
    ],

    async onMessage(text, ctx) {
      const trimmed = text.trim();

      if (trimmed.startsWith('wc:')) {
        await ctx.say(`That is a pairing link. Run /connect ${trimmed} and I will pair it.`);
        return;
      }

      if (/^https?:\/\//i.test(trimmed)) {
        await ctx.say(`Open it with /browse ${trimmed}.`);
        return;
      }

      const on = await enabledDapps(context);
      await ctx.say(
        on.length === 0
          ? 'Every dapp is switched off. /dapps turns one back on, or /adddapp adds your own.'
          : `/dapps lists what is here, /browse ${on[0].id} opens one, and /scan scans its WalletConnect code. Use /connect for a pairing link.`
      );
    },
  };
}
