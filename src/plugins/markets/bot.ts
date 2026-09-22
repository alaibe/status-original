import type { MessageContent } from '@/core/messaging/types';
import { poll, type Bot, type BotContext, type PluginContext } from '@/core/plugins/types';
import { W } from '@/design/widgets';

import { afterFiring, describeAlert, firedAlerts, symbolsToPoll, type FiredAlert } from './alerts';
import { displaySymbol, fetchPrices, formatPrice } from './api';
import { apiBase, readAlerts, writeAlerts } from './storage';

export const MARKETS_BOT_ID = 'markets';

const POLL_MS = 60_000;

export function makeMarketsBot(context: PluginContext): Bot {
  return {
    id: MARKETS_BOT_ID,
    name: 'Markets',
    tagline: 'Price alerts · on-device',
    emoji: '📈',

    greeting: () => [
      'This chat watches prices for you. Your alerts stay on this device, and I check them while the app is open.',
      'Set one:\n\n' +
        '/alert btc above 100000: tell me when it crosses\n' +
        '/alert eth below 2000: tell me when it drops\n' +
        '/alert sol 5%: tell me about every 5% move\n' +
        '/price btc: where it is right now\n' +
        '/alerts: what I am watching',
      'Prices come from a public exchange endpoint that needs no account. Point me at your own with /marketapi.',
    ],

    activate: poll(POLL_MS, async (ctx) => {
      await checkAlerts(context, ctx);
    }),

    async onMessage(text, ctx) {
      const symbol = text.trim().split(/\s+/)[0];
      await ctx.say(
        symbol
          ? `Try /price ${symbol.toLowerCase()} for a quote, or /alert ${symbol.toLowerCase()} above <price> and I will tell you when it gets there.`
          : 'Try /price btc, or /alert btc above 100000.'
      );
    },
  };
}

async function checkAlerts(context: PluginContext, ctx: BotContext): Promise<void> {
  const alerts = await readAlerts(context);
  if (alerts.length === 0) return;

  const prices = await fetchPrices(symbolsToPoll(alerts), apiBase());
  const fired = firedAlerts(alerts, prices);
  if (fired.length === 0) return;

  await writeAlerts(context, afterFiring(alerts, fired));
  for (const hit of fired) await ctx.say(alertMessage(hit));
}

export function alertMessage({ alert, price }: FiredAlert): MessageContent {
  const market = displaySymbol(alert.symbol);
  const headline = `${market} ${formatPrice(price)}`;

  const caption =
    alert.kind === 'move'
      ? `Moved ${(((price - alert.from) / alert.from) * 100).toFixed(2)}% from ${formatPrice(alert.from)}`
      : `Your alert: ${describeAlert(alert)}`;

  return {
    kind: 'widget',
    fallback: `${headline}. ${caption}`,
    widget: W.card(
      [
        W.stat(headline, {
          label: 'Alert',
          caption,
          tone: alert.kind === 'below' ? 'danger' : 'success',
        }),
        W.actions([
          { label: 'Quote', command: `/price ${alert.symbol}` },
          {
            label: alert.kind === 'move' ? 'All alerts' : 'Set another',
            command: alert.kind === 'move' ? '/alerts' : `/draft /alert ${alert.symbol} `,
            tone: 'neutral',
          },
        ]),
      ],
      { title: 'Price alert', icon: 'trending-up-outline' }
    ),
  };
}
