import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  Badge,
  Button,
  cn,
  Enter,
  Eyebrow,
  Icon,
  Sheet,
  Text,
  useThemeColors,
} from '@/design';
import { shortAddress } from '@/core/identity/keyring';
import type { MessageRendererProps, PluginContentType } from '@/core/plugins/types';

import { chainById } from '@/lib/evm/chains';
import {
  CONTENT_TYPE_PAYMENT_RECEIPT,
  CONTENT_TYPE_PAYMENT_REQUEST,
  CONTENT_TYPE_PAYMENT_SPLIT,
  type PaymentReceipt,
  type PaymentRequest,
  type SplitRequest,
} from './types';
import { walletErrorMessage } from './errors';
import { commitTransfer, networkOffMessage } from './transfer';
import { chainStrategies, type ChainStrategy } from './chains/strategy';

function CardShell({
  fromMe,
  children,
}: {
  fromMe: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      className={cn(
        'w-[260px] gap-3 rounded-bubble border p-3.5',
        fromMe ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface-raised'
      )}>
      {children}
    </View>
  );
}

function strategyFor(data: { chain?: string; chainId?: number }): ChainStrategy | undefined {
  const chains = chainStrategies();
  if (data.chain) return chains.find((c) => c.id === data.chain);
  if (data.chainId === undefined) return undefined;
  const legacy = chainById(data.chainId);
  return legacy ? chains.find((c) => c.name === legacy.name) : undefined;
}

function chainLabel(data: { chain?: string; chainId?: number }): string {
  const strategy = strategyFor(data);
  if (strategy) return strategy.name;
  if (data.chainId !== undefined) return chainById(data.chainId)?.name ?? `chain ${data.chainId}`;
  return data.chain ?? 'an unknown chain';
}

function PaymentRequestCard({ data, fromMe, context, message }: MessageRendererProps<PaymentRequest>) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [rows, setRows] = useState<{ label: string; value: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chain = strategyFor(data);

  async function review() {
    setError(null);
    setRows(null);
    setOpen(true);
    if (!chain?.transfer) {
      setError(networkOffMessage(chainLabel(data)));
      return;
    }
    setBusy(true);
    try {
      const quoted = await chain.transfer.quote(context, { amount: data.amount, to: data.to });
      if ('error' in quoted) setError(`${quoted.error} Nothing was sent.`);
      else setRows(quoted.rows);
    } catch (e) {
      setError(walletErrorMessage(e, chain, 'review'));
    }
    setBusy(false);
  }

  async function pay() {
    setError(null);
    if (!chain?.transfer) {
      setError(networkOffMessage(chainLabel(data)));
      return;
    }
    setBusy(true);
    const sent = await commitTransfer(
      chain,
      context,
      { amount: data.amount, to: data.to },
      {
        conversationId: message.conversationId,
        symbol: data.symbol,
        onSent: () => setPaid(true),
      }
    ).finally(() => setBusy(false));
    if (!sent.ok) {
      setRows(null);
      setError(sent.message);
      return;
    }

    context.ui.notify('Payment sent', 'success');
    setOpen(false);
  }

  return (
    <>
      <CardShell fromMe={fromMe}>
        <View className="flex-row items-center gap-2">
          <Icon name="arrow-down-circle" size={18} color={colors.brand} />
          <Eyebrow tone="brand">Payment request</Eyebrow>
        </View>

        <View className="gap-0.5">
          <Text className="text-[1.625rem] font-semibold tracking-tight tabular-nums text-content">
            {data.amount} {data.symbol}
          </Text>
          <Text variant="caption">
            to {shortAddress(data.to)} on {chainLabel(data)}
          </Text>
        </View>

        {data.note ? <Text variant="footnote">{data.note}</Text> : null}

        {fromMe ? (
          <Badge label="Waiting for payment" tone="warning" />
        ) : paid ? (
          <Badge label="Payment sent" tone="success" />
        ) : (
          <Button label={`Pay ${data.amount} ${data.symbol}`} size="sm" onPress={review} />
        )}
      </CardShell>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Review payment">
        <View className="gap-3">
          <View className="gap-2 rounded-card bg-surface-raised p-3">
            <Row label="Amount" value={`${data.amount} ${data.symbol}`} />
            <Row label="To" value={shortAddress(data.to, 8, 6)} />
            {rows?.map((row) => <Row key={row.label} label={row.label} value={row.value} />) ??
              null}
          </View>

          {error ? (
            <Animated.View entering={Enter.fade()}>
              <Text variant="caption" className="text-danger">
                {error}
              </Text>
            </Animated.View>
          ) : null}

          <Button
            label="Confirm and send"
            fullWidth
            loading={busy}
            disabled={rows === null || error !== null}
            onPress={pay}
          />
        </View>
      </Sheet>
    </>
  );
}

function SplitRequestCard({ data, fromMe, context, message }: MessageRendererProps<SplitRequest>) {
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  const chain = strategyFor(data);

  async function payShare() {
    setError(null);
    if (!chain?.transfer) {
      setError(networkOffMessage(chainLabel(data)));
      return;
    }
    setBusy(true);
    const sent = await commitTransfer(
      chain,
      context,
      { amount: data.share, to: data.to },
      {
        conversationId: message.conversationId,
        symbol: data.symbol,
        onSent: () => setPaid(true),
      }
    ).finally(() => setBusy(false));
    if (!sent.ok) setError(sent.message);
  }

  return (
    <CardShell fromMe={fromMe}>
      <View className="flex-row items-center gap-1.5">
        <Icon name="pie-chart-outline" size={15} color={colors.brand} />
        <Eyebrow>{data.note ? `Split · ${data.note}` : 'Split'}</Eyebrow>
      </View>

      <Text className="text-[1.625rem] font-semibold tracking-tight tabular-nums">
        {data.share} {data.symbol}
      </Text>
      <Text variant="caption">
        your share of {data.total} {data.symbol}, {data.people} ways
      </Text>

      <Row label="Network" value={chain?.name ?? `Chain ${data.chainId}`} />
      <Row label="Goes to" value={shortAddress(data.to)} />

      {error ? (
        <Text variant="caption" className="text-danger">
          {error}
        </Text>
      ) : null}

      {fromMe ? (
        <Text variant="caption">Waiting for the others to settle.</Text>
      ) : paid ? (
        <Text variant="caption" className="text-success">
          Your share is paid.
        </Text>
      ) : (
        <Button
          label={busy ? 'Sending…' : `Pay ${data.share} ${data.symbol}`}
          disabled={busy}
          fullWidth
          onPress={payShare}
        />
      )}
    </CardShell>
  );
}

function PaymentReceiptCard({ data, fromMe }: MessageRendererProps<PaymentReceipt>) {
  const colors = useThemeColors();
  const legacy = data.chainId === undefined ? undefined : chainById(data.chainId);
  const explorer = legacy?.blockExplorers?.default.url;

  return (
    <CardShell fromMe={fromMe}>
      <View className="flex-row items-center gap-2">
        <Icon name="checkmark-circle" size={18} color={colors.success} />
        <Eyebrow tone="success">Payment sent</Eyebrow>
      </View>

      <Text className="text-[1.375rem] font-semibold tracking-tight tabular-nums text-content">
        {data.amount} {data.symbol}
      </Text>

      <Text variant="caption">
        {shortAddress(data.hash, 10, 8)} on {chainLabel(data)}
      </Text>

      {explorer ? <Text variant="micro">View on {new URL(explorer).hostname}</Text> : null}
    </CardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text variant="caption">{label}</Text>
      <Text variant="footnote" className="font-medium text-content">
        {value}
      </Text>
    </View>
  );
}

export const walletContentTypes: PluginContentType<any>[] = [
  {
    typeId: CONTENT_TYPE_PAYMENT_REQUEST,
    fallback: (data: PaymentRequest) =>
      `Payment request: ${data.amount} ${data.symbol}${data.note ? ` (${data.note})` : ''}`,
    render: PaymentRequestCard,
  },
  {
    typeId: CONTENT_TYPE_PAYMENT_SPLIT,
    render: SplitRequestCard,
    fallback: (data: SplitRequest) =>
      `Split ${data.total} ${data.symbol} ${data.people} ways, ${data.share} each`,
  },
  {
    typeId: CONTENT_TYPE_PAYMENT_RECEIPT,
    fallback: (data: PaymentReceipt) => `Sent ${data.amount} ${data.symbol} (${data.hash})`,
    render: PaymentReceiptCard,
  },
];
