import { View } from 'react-native';
import { cn, Text } from '@/design';

export interface RecoveryPhraseProps {
  phrase: string;
  className?: string;
}

export function RecoveryPhrase({ phrase, className }: RecoveryPhraseProps) {
  const words = phrase.split(' ');

  return (
    <View className={cn('flex-row flex-wrap gap-2', className)}>
      {words.map((word, i) => (
        <View
          key={`${word}-${i}`}
          className="min-w-[30%] flex-1 flex-row items-baseline gap-1.5 rounded-field bg-surface-sunken px-2.5 py-2">
          <Text variant="micro" className="shrink-0 tabular-nums">
            {i + 1}
          </Text>
          <Text className="min-w-0 text-footnote font-medium">{word}</Text>
        </View>
      ))}
    </View>
  );
}
