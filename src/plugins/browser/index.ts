import { liveViews } from '@/core/plugins/live';
import type { Plugin, PluginContext } from '@/core/plugins/types';

import { makeBrowserBot } from './bot';
import { makeApprovalOverlay } from './screens/approval-overlay';
import { makeScanOverlay } from './screens/scan-overlay';
import { W } from '@/design/widgets';

import type { Bookmark } from './config';
import { addBookmark, bookmarks, findBookmark, hostOf, removeBookmark } from './bookmarks';
import { useWalletConnectStore } from './walletconnect';
import { errorMessage } from '@/core/errors';

export const browserPlugin: Plugin = {
  manifest: {
    id: 'browser',
    name: 'Browser',
    description:
      'Open bookmarked sites in your system browser and connect them to your wallet over WalletConnect.',
    version: '1.0.0',
    icon: 'compass-outline',
    permissions: ['identity.read', 'identity.sign', 'browser.open', 'network', 'storage'],
  },

  setup(context) {
    const views = liveViews(context, { bookmarks: () => bookmarksCard(context) });
    return {
      overlays: [
        { id: 'wc-approval', component: makeApprovalOverlay(context) },
        { id: 'wc-scan', component: makeScanOverlay(context) },
      ],

      bots: [makeBrowserBot(context)],

      composerActions: [
        {
          id: 'bookmarks',
          label: 'Bookmarks',
          icon: 'book-outline',
          command: '/bookmarks',
          showIn: ['channel'],
        },
        {
          id: 'scan',
          label: 'Scan',
          icon: 'qr-code-outline',
          command: '/scan',
          showIn: ['channel'],
        },
        {
          id: 'bookmark',
          label: 'Add bookmark',
          icon: 'add-circle-outline',
          command: '/bookmark',
          showIn: ['channel'],
        },
      ],

      views,

      commands: [
        {
          name: 'open',
          showIn: ['channel'],
          aliases: ['browse'],
          description: 'Open a bookmark, or any URL, with this wallet ready',
          usage: '/open <uniswap | app.aave.com>',
          async run({ rest, context: ctx, respond }) {
            const target = rest.trim();
            if (!target) return { type: 'error', message: 'Which site? /open uniswap' };

            const known = await findBookmark(context, target);
            if (known) {
              await respond(
                `Opening ${known.name}. Choose Connect → WalletConnect there and the request ` +
                  'comes back here for approval.'
              );
              await ctx.ui.openExternalUrl(known.url);
              return { type: 'handled' };
            }

            if (!/\./.test(target)) {
              return {
                type: 'error',
                message: `No bookmark called "${target}", and that is not a web address. /bookmarks lists what is here.`,
              };
            }

            const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
            await ctx.ui.openExternalUrl(url);
            return { type: 'handled' };
          },
        },
        {
          name: 'bookmarks',
          showIn: ['channel'],
          description: 'The sites you can open',
          usage: '/bookmarks',
          async run({ respond }) {
            await respond(await views.bookmarks());
            return { type: 'handled' };
          },
        },

        {
          name: 'bookmark',
          showIn: ['channel'],
          description: 'Add a site of your own, or bring back one you removed',
          usage: '/bookmark <url> [name]',
          async run({ args, respond }) {
            const [url, ...nameParts] = args;
            if (!url) {
              await respond({
                kind: 'widget',
                fallback: 'Add a bookmark',
                widget: W.card(
                  [
                    W.form(
                      [
                        { id: 'url', label: 'Address', placeholder: 'app.example.xyz' },
                        {
                          id: 'name',
                          label: 'Name',
                          placeholder: 'Taken from the address',
                          optional: true,
                        },
                      ],
                      { label: 'Add it', command: '/bookmark {url} {name}' }
                    ),
                    W.text(
                      'It opens in your system browser like the rest, and connects back over ' +
                        'WalletConnect. Nothing runs inside this app, so adding a site cannot ' +
                        'give it code on your phone. It can still ask you to sign things, so ' +
                        'only add one you trust.'
                    ),
                  ],
                  { title: 'Add a bookmark', icon: 'add-circle-outline' }
                ),
              });
              return { type: 'handled' };
            }

            const added = await addBookmark(context, url, nameParts.join(' '));
            if ('error' in added) return { type: 'error', message: added.error };

            return {
              type: 'notice',
              tone: 'success',
              message: `${added.restored ? 'Restored' : 'Added'} ${added.bookmark.name}`,
            };
          },
        },

        {
          name: 'unbookmark',
          showIn: ['channel'],
          description: 'Remove a site from the list',
          usage: '/unbookmark <name>',
          async run({ args }) {
            const [name] = args;
            if (!name) return { type: 'error', message: 'Which one? /bookmarks lists them.' };

            const bookmark = await findBookmark(context, name);
            if (!bookmark) {
              return { type: 'error', message: `No bookmark called "${name}". /bookmarks lists them.` };
            }

            await removeBookmark(context, bookmark);
            return {
              type: 'notice',
              tone: 'success',
              message: bookmark.custom
                ? `Removed ${bookmark.name}`
                : `Removed ${bookmark.name}. /bookmark ${bookmark.id} brings it back.`,
            };
          },
        },

        {
          name: 'connected',
          aliases: ['sessions'],
          showIn: ['channel'],
          description: 'Sites paired with this wallet, and how to unpair them',
          usage: '/connected',
          async run({ respond }) {
            const kit = useWalletConnectStore.getState().kit;
            const sessions = kit ? Object.values(kit.getActiveSessions()) : [];

            if (sessions.length === 0) {
              await respond({
                kind: 'widget',
                fallback: 'Nothing is connected',
                widget: W.card(
                  [
                    W.text(
                      'Nothing is paired right now. Open a site, choose WalletConnect, and ' +
                        'scan the code it shows with /scan.'
                    ),
                    W.actions([{ label: 'Scan a code', command: '/scan' }]),
                  ],
                  { title: 'Connected sites', icon: 'link-outline' }
                ),
              });
              return { type: 'handled' };
            }

            await respond({
              kind: 'widget',
              fallback: sessions.map((session) => session.peer.metadata.name).join(' · '),
              widget: W.card(
                [
                  W.list(
                    sessions.map((session) => ({
                      title: session.peer.metadata.name || 'A site',
                      subtitle: session.peer.metadata.url,
                      icon: 'link-outline' as const,
                      state: 'on' as const,
                      actions: [
                        ...(session.peer.metadata.url
                          ? [
                              {
                                label: `Open ${session.peer.metadata.name || 'it'}`,
                                command: `/open ${session.peer.metadata.url}`,
                                icon: 'open-outline' as const,
                              },
                            ]
                          : []),
                        {
                          label: `Disconnect ${session.peer.metadata.name || 'it'}`,
                          command: `/disconnect ${session.topic}`,
                          icon: 'power' as const,
                          tone: 'danger' as const,
                        },
                      ],
                    }))
                  ),
                  W.text(
                    'A paired site can ask this wallet to sign things. It cannot sign anything ' +
                      'itself; every request comes back here for you to approve.'
                  ),
                ],
                { title: 'Connected sites', icon: 'link-outline' }
              ),
            });
            return { type: 'handled' };
          },
        },

        {
          name: 'disconnect',
          showIn: ['channel'],
          description: 'Unpair a site',
          usage: '/disconnect <topic>',
          async run({ args }) {
            const [topic] = args;
            if (!topic) return { type: 'error', message: 'Which one? /connected lists them.' };

            try {
              await useWalletConnectStore.getState().disconnectSession(topic);
              return {
                type: 'notice',
                tone: 'success',
                message: 'Disconnected. That site has to pair again.',
              };
            } catch (error) {
              return { type: 'error', message: errorMessage(error, 'Could not disconnect') };
            }
          },
        },

        {
          name: 'scan',
          showIn: ['channel'],
          description: 'Scan a WalletConnect QR code with your camera',
          usage: '/scan',
          async run() {
            useWalletConnectStore.getState().setScanning(true);
            return { type: 'handled' };
          },
        },

        {
          name: 'connect',
          showIn: ['channel'],
          aliases: ['wc'],
          description: 'Connect using a pasted WalletConnect link',
          usage: '/connect <wc:…>',
          async run({ rest, context: ctx }) {
            const uri = rest.trim();

            if (!uri) {
              return {
                type: 'error',
                message: 'Use /scan for a QR code, or /connect wc:… to paste a pairing link.',
              };
            }

            if (!uri.startsWith('wc:')) {
              return {
                type: 'error',
                message: 'That is not a WalletConnect link. Use /scan to scan a QR code.',
              };
            }
            try {
              await useWalletConnectStore.getState().pair(uri);
              ctx.ui.notify('Pairing… approve the request when it appears.');
              return { type: 'handled' };
            } catch (error) {
              return {
                type: 'error',
                message: errorMessage(error, 'Could not pair'),
              };
            }
          },
        },
      ],

      uriHandlers: [
        {
          schemes: ['wc'],
          async handle(url, ctx) {
            const store = useWalletConnectStore.getState();
            if (!store.kit) await store.init(ctx);

            try {
              await useWalletConnectStore.getState().pair(url);
              return true;
            } catch (error) {
              console.warn('[browser] pairing failed', error);
              return false;
            }
          },
        },
      ],

      async start() {
        await useWalletConnectStore.getState().init(context);
        return () => {
          useWalletConnectStore.getState().shutdown();
        };
      },
    };
  },
};


async function bookmarksCard(context: PluginContext) {
  const saved = await bookmarks(context);

  return {
    kind: 'widget' as const,
    fallback: saved.map((b) => b.name).join(' · ') || 'No bookmarks',
    widget: W.card(
      [
        W.list(
          saved.map((bookmark: Bookmark) => ({
            title: bookmark.name,
            subtitle: bookmark.description,
            icon: bookmark.icon,
            status: hostOf(bookmark.url),
            tone: 'brand' as const,
            // Opening it is what you came for, so it leads and its glyph is
            // what the row shows. Removing sits behind it.
            actions: [
              {
                label: `Open ${bookmark.name}`,
                command: `/open ${bookmark.id}`,
                icon: 'open-outline' as const,
              },
              {
                label: `Remove ${bookmark.name}`,
                command: `/unbookmark ${bookmark.id}`,
                icon: 'trash-outline' as const,
                tone: 'danger' as const,
              },
            ],
          }))
        ),
        W.text(
          'Sites open in your system browser, not inside this app, so your existing sessions ' +
            'keep working and no page ever runs here. To connect one, choose WalletConnect ' +
            'there and the request comes back for approval. /bookmark adds your own.'
        ),
      ],
      { title: 'Bookmarks', icon: 'book-outline' }
    ),
  };
}
