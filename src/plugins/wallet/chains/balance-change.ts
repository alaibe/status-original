import type { MessageContent } from '@/core/messaging/types';
import type { IconName } from '@/design';
import { W } from '@/design/widgets';

export function balanceChangeCard({
  fallback,
  title,
  icon,
  headline,
  label,
  caption,
  tone,
  address,
  chain,
  short,
}: {
  fallback: string;
  title: string;
  icon: IconName;
  headline: string;
  label: string;
  caption: string;
  tone: 'success' | 'warning';
  address: string;
  /** The `--chain` value the card's buttons pass back. */
  chain: string;
  short: (address: string) => string;
}): MessageContent {
  return {
    kind: 'widget',
    fallback,
    widget: W.card(
      [
        W.stat(headline, { label, caption, tone }),
        W.rows([
          {
            label: 'Address',
            value: short(address),
            actions: [
              { label: 'Open in explorer', command: `/explorer ${address} --chain ${chain}` },
              { label: 'Full balance', command: `/balance --chain ${chain}`, tone: 'neutral' },
            ],
          },
        ]),
      ],
      { title, icon }
    ),
  };
}
