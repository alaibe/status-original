import { errorMessage } from '@/core/errors';
import type { PluginContext, PluginView, SlashCommand } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { describeAlert, parseAlert, toAlert } from './alerts';
import {
  DEFAULT_API_BASE,
  displaySymbol,
  fetchTicker,
  formatPercent,
  formatPrice,
  normaliseSymbol,
} from './api';
import { apiBase, isDefaultApiBase, readAlerts, saveApiBase, writeAlerts } from './storage';

const DEFAULT_MARKETS = ['BTCUSDT', 'ETHUSDT'];

export async function alertsCard(context: PluginContext) {
  const alerts = await readAlerts(context);

  if (alerts.length === 0) {
    return {
      kind: 'widget' as const,
      fallback: 'No alerts',
      widget: W.card([W.text('No alerts yet. Set one with /alert btc above 100000.')], {
        title: 'Price alerts',
        icon: 'notifications-outline',
      }),
    };
  }

  return {
    kind: 'widget' as const,
    fallback: `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`,
    widget: W.card(
      [
        W.rows(
          alerts.map((alert, index) => ({
            label: `${index + 1}`,
            value: describeAlert(alert),
            actions: [
              { label: 'Remove', command: `/unalert ${index + 1}`, tone: 'danger' as const },
            ],
          }))
        ),
        W.text('Threshold alerts clear once they fire. Percentage alerts keep going.'),
      ],
      { title: 'Price alerts', icon: 'notifications-outline' }
    ),
  };
}

export function marketsCommands(
  context: PluginContext,
  views: { alerts: PluginView; marketapi: PluginView }
): SlashCommand[] {
  return [
    {
      name: 'price',
      showIn: ['channel'],
      aliases: ['quote'],
      description: 'The current price of a market',
      usage: '/price [btc | eth | SOLUSDT]',
      async run({ args, respond }) {
        const symbols = args[0] ? [normaliseSymbol(args[0])] : DEFAULT_MARKETS;

        try {
          const tickers = await Promise.all(symbols.map((s) => fetchTicker(s, apiBase())));

          await respond({
            kind: 'widget',
            fallback: tickers
              .map((t) => `${displaySymbol(t.symbol)} ${formatPrice(t.price)}`)
              .join(' · '),
            widget: W.card(
              [
                ...(tickers.length === 1
                  ? [
                      W.stat(formatPrice(tickers[0].price), {
                        label: displaySymbol(tickers[0].symbol),
                        caption: `${formatPercent(tickers[0].changePercent)} over 24h · high ${formatPrice(tickers[0].high)} · low ${formatPrice(tickers[0].low)}`,
                        tone: tickers[0].changePercent >= 0 ? 'success' : 'danger',
                      }),
                    ]
                  : [
                      W.rows(
                        tickers.map((t) => ({
                          label: displaySymbol(t.symbol),
                          value: `${formatPrice(t.price)}  ${formatPercent(t.changePercent)}`,
                          tone: t.changePercent >= 0 ? ('success' as const) : ('danger' as const),
                        }))
                      ),
                    ]),
                W.actions(
                  tickers.map((t) => ({
                    label: `Alert on ${displaySymbol(t.symbol)}`,
                    command: `/draft /alert ${t.symbol} above `,
                    tone: 'neutral' as const,
                  }))
                ),
              ],
              { title: 'Markets', icon: 'trending-up-outline' }
            ),
          });
          return { type: 'handled' };
        } catch (error) {
          return {
            type: 'error',
            message: errorMessage(error, 'Could not reach the market data.'),
          };
        }
      },
    },

    {
      name: 'alert',
      showIn: ['channel'],
      description: 'Tell the Markets chat to watch a price for you',
      usage: '/alert <market> <above|below> <price>, or /alert <market> <n>%',
      async run({ args, respond }) {
        if (args.length === 0) return { type: 'setComposer', text: '/alert ' };
        const spec = parseAlert(args);
        if ('error' in spec) return { type: 'error', message: spec.error };

        let price: number;
        try {
          price = (await fetchTicker(spec.symbol, apiBase())).price;
        } catch (error) {
          return { type: 'error', message: errorMessage(error, 'Could not price that market.') };
        }

        const alert = toAlert(spec, price, Date.now());
        await writeAlerts(context, [...(await readAlerts(context)), alert]);

        await respond({
          kind: 'widget',
          fallback: `Watching ${describeAlert(alert)}`,
          widget: W.card(
            [
              W.rows([
                { label: 'Watching', value: describeAlert(alert) },
                { label: 'Right now', value: formatPrice(price) },
              ]),
              W.text('I will say so in the Markets chat. Nothing leaves this device.'),
            ],
            { title: 'Alert set', icon: 'notifications-outline' }
          ),
        });
        return { type: 'handled' };
      },
    },

    {
      name: 'alerts',
      showIn: ['channel'],
      description: 'The price alerts you have set',
      usage: '/alerts',
      async run({ respond }) {
        await respond(await views.alerts());
        return { type: 'handled' };
      },
    },

    {
      name: 'unalert',
      showIn: ['channel'],
      description: 'Remove a price alert',
      usage: '/unalert <number | market>',
      async run({ args }) {
        const alerts = await readAlerts(context);
        const [target] = args;
        if (!target) return { type: 'error', message: 'Which one? /alerts lists them by number.' };

        const index = Number(target) - 1;
        const remaining = Number.isInteger(index)
          ? alerts.filter((_, i) => i !== index)
          : alerts.filter((a) => a.symbol !== normaliseSymbol(target));

        if (remaining.length === alerts.length) {
          return { type: 'error', message: `No alert matches "${target}". See /alerts.` };
        }

        const gone = alerts.length - remaining.length;
        await writeAlerts(context, remaining);
        return {
          type: 'notice',
          tone: 'success',
          message: `Removed ${gone} alert${gone === 1 ? '' : 's'}`,
        };
      },
    },

    {
      name: 'marketapi',
      showIn: ['channel'],
      description: 'Point price lookups at a different venue',
      usage: '/marketapi <url | reset>',
      async run({ args, respond }) {
        const [value] = args;

        if (!value) {
          await respond(await views.marketapi());
          return { type: 'handled' };
        }

        if (value === 'reset') {
          await saveApiBase(context, null);
          return {
            type: 'notice',
            tone: 'success',
            message: `Back on the default market API, ${DEFAULT_API_BASE}`,
          };
        }

        if (!/^https:\/\//i.test(value)) {
          return { type: 'error', message: 'The endpoint must start with https://.' };
        }

        await saveApiBase(context, value.replace(/\/$/, ''));
        return { type: 'notice', tone: 'success', message: `Prices come from ${value} now` };
      },
    },
  ];
}

export function marketApiCard() {
  return {
    kind: 'widget' as const,
    fallback: `Market data: ${apiBase()}`,
    widget: W.card(
      [
        W.code(apiBase(), {
          label: isDefaultApiBase(apiBase()) ? 'Now using (default)' : 'Now using',
        }),
        W.text(
          'Any host exposing a Binance-compatible /ticker/24hr works. No API key is ' +
            'used or stored. Change it with /marketapi https://your-host/api/v3, or ' +
            '/marketapi reset.'
        ),
      ],
      { title: 'Market data', icon: 'server-outline' }
    ),
  };
}
