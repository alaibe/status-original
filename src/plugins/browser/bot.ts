import type { Bot, PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { walletConnectProjectId } from './config';
import { bookmarks } from './bookmarks';

export const BROWSER_BOT_ID = 'browser';

export function makeBrowserBot(context: PluginContext): Bot {
  return {
    id: BROWSER_BOT_ID,
    name: 'Browser',
    tagline: 'Your wallet, in the browser',
    emoji: '🌐',

    greeting: () => [
      'Sites open in your own browser and connect back to this wallet over WalletConnect, so your existing sessions and extensions keep working.',
      {
        kind: 'widget',
        fallback: '/bookmarks, /open, /bookmark, /scan, /connect',
        widget: W.card(
          [
            W.list([
              {
                title: '/bookmarks',
                subtitle: 'The sites you can open',
                actions: [{ label: 'Show them', command: '/bookmarks' }],
              },
              {
                title: '/open uniswap',
                subtitle: 'Open a bookmark by name, or any address',
                actions: [{ label: 'Try it', command: '/draft /open ' }],
              },
              {
                title: '/bookmark',
                subtitle: 'Add a site of your own',
                actions: [{ label: 'Add one', command: '/bookmark' }],
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
          { title: 'Browser', icon: 'compass-outline' }
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
        await ctx.say(`Open it with /open ${trimmed}.`);
        return;
      }

      const saved = await bookmarks(context);
      await ctx.say(
        saved.length === 0
          ? 'No bookmarks yet. /bookmark adds a site, or brings back one you removed.'
          : `/bookmarks lists what is here, /open ${saved[0].id} opens one, and /scan scans its WalletConnect code. Use /connect for a pairing link.`
      );
    },
  };
}
