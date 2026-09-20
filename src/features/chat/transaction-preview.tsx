import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { cn, Icon, Pressable, Text, useThemeColors } from '@/design';
import { shortAddress } from '@/core/identity/keyring';
import { SUPPORTED_CHAINS } from '@/lib/evm/chains';
import { locateTransaction, type TransactionSummary } from '@/lib/evm/transactions';

export function TransactionPreview({ hash, fromMe }: { hash: `0x${string}`; fromMe: boolean }) {
  const colors = useThemeColors();
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [looking, setLooking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    locateTransaction(
      hash,
      SUPPORTED_CHAINS.map((chain) => chain.id)
    )
      .then((found) => {
        if (!cancelled) setSummary(found);
      })
      .finally(() => {
        if (!cancelled) setLooking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (looking || !summary) return null;

  const tone =
    summary.status === 'success'
      ? colors.success
      : summary.status === 'reverted'
        ? colors.danger
        : colors.warning;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Transaction on ${summary.chainName}`}
      onPress={() => {
        if (summary.explorerUrl) WebBrowser.openBrowserAsync(summary.explorerUrl).catch(() => {});
      }}
      className={cn(
        'mt-1.5 gap-1 rounded-md border p-2',
        fromMe ? 'border-bubble-out-on/25' : 'border-line'
      )}
      style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center gap-1.5">
        <Icon
          name={
            summary.status === 'success'
              ? 'checkmark-circle'
              : summary.status === 'reverted'
                ? 'close-circle'
                : 'time-outline'
          }
          size={14}
          color={tone}
        />
        <Text variant="caption" className="font-semibold" style={{ color: tone }}>
          {summary.status === 'success'
            ? 'Confirmed'
            : summary.status === 'reverted'
              ? 'Reverted'
              : 'Pending'}
        </Text>
        <Text variant="micro">· {summary.chainName}</Text>
      </View>

      <Text className={cn('font-semibold', fromMe && 'text-bubble-out-on')}>
        {summary.value} {summary.symbol}
      </Text>

      <Text variant="micro" numberOfLines={1}>
        {shortAddress(summary.from)} → {summary.to ? shortAddress(summary.to) : 'contract creation'}
      </Text>
    </Pressable>
  );
}
