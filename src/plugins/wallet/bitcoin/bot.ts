import type { MessageContent } from '@/core/messaging/types';
import type { PluginContext } from '@/core/plugins/types';

import { BIP84_ACCOUNT_PATH, p2wpkhAddress } from './address';
import { formatBtc, fetchAddressStats, type AddressStats } from './api';
import { apiBase } from './config';
import { balanceChangeCard } from '../chains/balance-change';
import type { Say } from '../chains/strategy';

export const BITCOIN_BOT_ID = 'bitcoin';

const STORAGE_SEEN = 'bot-seen-stats';

interface SeenStats {
  confirmed: string;
  pending: string;
}

export async function checkAddress(context: PluginContext, say: Say): Promise<void> {
  let address: string;
  try {
    address = p2wpkhAddress(context.identity.derive(BIP84_ACCOUNT_PATH).publicKey);
  } catch {
    return;
  }

  const stats = await fetchAddressStats(address, apiBase());
  const seen = await context.storage.get<SeenStats>(STORAGE_SEEN);
  const current: SeenStats = {
    confirmed: stats.confirmed.toString(),
    pending: stats.pending.toString(),
  };

  if (seen?.confirmed !== current.confirmed || seen?.pending !== current.pending) {
    await context.storage.set<SeenStats>(STORAGE_SEEN, current);
  }

  if (!seen) return;

  const message = describeChange(
    { confirmed: BigInt(seen.confirmed), pending: BigInt(seen.pending) },
    stats,
    address
  );
  if (message) await say(message);
}

export function describeChange(
  previous: Pick<AddressStats, 'confirmed' | 'pending'>,
  current: Pick<AddressStats, 'confirmed' | 'pending'>,
  address: string
): MessageContent | null {
  const confirmedDelta = current.confirmed - previous.confirmed;

  if (confirmedDelta !== 0n) {
    const received = confirmedDelta > 0n;
    const amount = formatBtc(received ? confirmedDelta : -confirmedDelta);
    return card({
      title: received ? 'Confirmed' : 'Spent',
      headline: `${received ? '+' : '−'}${amount} BTC`,
      caption: `Now ${formatBtc(current.confirmed)} BTC confirmed`,
      tone: received ? 'success' : 'warning',
      address,
    });
  }

  if (current.pending !== previous.pending && current.pending !== 0n) {
    const incoming = current.pending > 0n;
    const amount = formatBtc(incoming ? current.pending : -current.pending);
    return card({
      title: 'In the mempool',
      headline: `${incoming ? '+' : '−'}${amount} BTC`,
      caption: incoming
        ? 'Unconfirmed. I will say so again when it lands in a block.'
        : 'Leaving your address, not yet confirmed.',
      tone: 'warning',
      address,
    });
  }

  return null;
}

function card({
  title,
  headline,
  caption,
  tone,
  address,
}: {
  title: string;
  headline: string;
  caption: string;
  tone: 'success' | 'warning';
  address: string;
}): MessageContent {
  return balanceChangeCard({
    fallback: `${title}: ${headline}. ${caption}`,
    title,
    icon: 'logo-bitcoin',
    headline,
    label: 'Bitcoin',
    caption,
    tone,
    address,
    chain: 'bitcoin',
    short: (a) => `${a.slice(0, 10)}…${a.slice(-6)}`,
  });
}
