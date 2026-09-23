import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { cn, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import type { MessageContent } from '@/core/messaging/types';

type Poll = Extract<MessageContent, { kind: 'poll' }>;

export function PollBubble({
  poll,
  fromMe,
  onVote,
}: {
  poll: Poll;
  fromMe: boolean;
  onVote?: (optionIds: number[]) => Promise<void>;
}) {
  const chosen = poll.options.flatMap((option, index) => (option.chosen ? [index] : []));
  const [selected, setSelected] = useState<number[] | null>(null);
  const currentSelection = selected ?? chosen;
  const [busy, setBusy] = useState(false);
  const voted = chosen.length > 0;
  const canVote = !!onVote && !poll.closed && !busy;
  const textColor = fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on';

  const submit = async (ids: number[]) => {
    if (!canVote) return;
    setBusy(true);
    try {
      await onVote(ids);
      setSelected(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not vote'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="min-w-52 gap-2 py-1">
      <Text className={cn('font-semibold', textColor)}>{poll.question}</Text>
      <Text variant="micro" className={fromMe ? 'text-bubble-out-on/70' : undefined}>
        {poll.multiple ? 'Choose one or more' : 'Choose one'}
      </Text>
      {poll.options.map((option, index) => {
        const active = currentSelection.includes(index);
        return (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`${option.text}${option.chosen ? ', selected' : ''}`}
            disabled={!canVote || (!poll.multiple && option.chosen)}
            onPress={() =>
              poll.multiple
                ? setSelected((current) => {
                    const ids = current ?? chosen;
                    return ids.includes(index) ? ids.filter((id) => id !== index) : [...ids, index];
                  })
                : void submit([index])
            }
            className={cn(
              'min-h-10 flex-row items-center gap-2 rounded-lg px-2 py-1.5',
              fromMe ? 'bg-bubble-out-on/10' : 'bg-content/5'
            )}>
            <Text className={textColor}>
              {poll.multiple ? (active ? '☑' : '□') : active ? '◉' : '○'}
            </Text>
            <Text className={cn('min-w-0 flex-1', textColor)}>{option.text}</Text>
            {voted || poll.closed ? (
              <Text variant="caption" className={textColor}>
                {option.percentage}%
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {poll.multiple &&
      canVote &&
      selected &&
      selected.length > 0 &&
      (selected.length !== chosen.length || selected.some((id) => !chosen.includes(id))) ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void submit(selected)}
          className="items-center rounded-lg bg-brand px-3 py-2">
          <Text className="font-semibold text-white">Vote</Text>
        </Pressable>
      ) : null}
      <Text variant="micro" className={fromMe ? 'text-bubble-out-on/70' : undefined}>
        {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
        {poll.closed ? ' · Closed' : ''}
      </Text>
    </View>
  );
}
