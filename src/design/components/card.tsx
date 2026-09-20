import { View, type ViewProps } from 'react-native';

import { cn } from '../lib/cn';

export interface CardProps extends ViewProps {
  className?: string;
  tone?: 'flat' | 'raised';
}

export function Card({ className, tone = 'raised', ...props }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-card border border-line p-gutter',
        tone === 'raised' ? 'bg-surface-raised' : 'bg-surface',
        className
      )}
      style={{ borderCurve: 'continuous' }}
      {...props}
    />
  );
}
