import { View, type ViewProps } from 'react-native';

import { Eyebrow } from './eyebrow';
import { cn } from '../lib/cn';

export interface SectionProps extends ViewProps {
  title?: string;
  surface?: 'plain' | 'list' | 'card';
  className?: string;
}

export function Section({
  title,
  surface = 'plain',
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <View className={className} {...props}>
      {title ? (
        <Eyebrow className={cn('mb-1.5', surface === 'card' ? 'px-7' : 'px-gutter')}>
          {title}
        </Eyebrow>
      ) : null}
      <View
        style={surface === 'card' ? { borderCurve: 'continuous' } : undefined}
        className={cn(
          surface === 'list' && 'border-y border-line bg-surface-raised',
          surface === 'card' &&
            'mx-gutter overflow-hidden rounded-card bg-surface-raised'
        )}>
        {children}
      </View>
    </View>
  );
}
