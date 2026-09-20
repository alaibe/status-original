import { View } from 'react-native';

import { Text } from './text';
import { cn } from '../lib/cn';

export interface ScreenTitleProps {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export function ScreenTitle({ title, actions, className }: ScreenTitleProps) {
  return (
    <View className={cn('flex-row items-center justify-between gap-3 px-gutter', className)}>
      <Text variant="display" className="min-w-0 flex-1">
        {title}
      </Text>
      {actions ? <View className="shrink-0 flex-row items-center gap-1">{actions}</View> : null}
    </View>
  );
}
