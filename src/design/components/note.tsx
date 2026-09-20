import { View } from 'react-native';

import { cn } from '../lib/cn';
import { Icon, type IconName } from '../icon';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Text } from './text';

export interface NoteProps {
  title?: string;
  icon?: IconName;
  children: React.ReactNode;
  className?: string;
}

export function Note({ title, icon, children, className }: NoteProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{ borderCurve: 'continuous' }}
      className={cn('rounded-card border border-brand/15 bg-brand-soft p-4', className)}>
      {title ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            {icon ? <Icon name={icon} size={16} color={colors.brand} /> : null}
            <Text variant="caption" className="font-semibold text-brand">
              {title}
            </Text>
          </View>
          {children}
        </View>
      ) : icon ? (
        <View className="flex-row items-start gap-2.5">
          <View className="pt-0.5">
            <Icon name={icon} size={16} color={colors.brand} />
          </View>
          <View className="min-w-0 flex-1 gap-2">{children}</View>
        </View>
      ) : (
        <View className="gap-2">{children}</View>
      )}
    </View>
  );
}
