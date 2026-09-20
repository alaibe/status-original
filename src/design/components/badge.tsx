import { View } from 'react-native';

import { cn } from '../lib/cn';
import { Text } from './text';

const TONE = {
  neutral: 'bg-surface-sunken',
  brand: 'bg-brand-soft',
  success: 'bg-success/15',
  warning: 'bg-warning/15',
  danger: 'bg-danger/15',
} as const;

const LABEL = {
  neutral: 'text-content-muted',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export interface BadgeProps {
  label: string;
  tone?: keyof typeof TONE;
  className?: string;
}

export function Badge({ label, tone = 'neutral', className }: BadgeProps) {
  return (
    <View className={cn('self-start rounded-pill px-2 py-0.5', TONE[tone], className)}>
      <Text className={cn('text-micro font-semibold uppercase tracking-wide', LABEL[tone])}>
        {label}
      </Text>
    </View>
  );
}
