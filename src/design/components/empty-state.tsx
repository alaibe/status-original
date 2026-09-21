import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Enter } from '../motion';
import { Button } from './button';
import { Text } from './text';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Animated.View
      entering={Enter.content()}
      className="flex-1 items-center justify-center gap-3 px-8">
      {icon ? <View className="mb-1 opacity-60">{icon}</View> : null}
      <Text variant="title" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text variant="footnote" className="text-center">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} tone="brand" onPress={onAction} className="mt-2" />
      ) : null}
    </Animated.View>
  );
}
