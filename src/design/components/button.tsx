import * as Haptics from 'expo-haptics';
import { ActivityIndicator } from 'react-native';

import { cn } from '../lib/cn';
import { Pressable, type PressScaleProps } from './pressable';
import { Text } from './text';

const TONE = {
  primary: { view: 'bg-brand active:bg-brand-strong', label: 'text-brand-on font-semibold' },
  neutral: { view: 'bg-surface-raised border border-line', label: 'text-content font-medium' },
  ghost: { view: 'bg-transparent', label: 'text-brand font-medium' },
  danger: { view: 'bg-danger', label: 'text-white font-semibold' },
} as const;

const SIZE = {
  sm: { view: 'h-9 px-3 rounded-field', label: 'text-footnote' },
  md: { view: 'h-tap px-4 rounded-field', label: 'text-body' },
} as const;

const SM_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export interface ButtonProps extends Omit<PressScaleProps, 'children'> {
  label: string;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  loading?: boolean;
  haptic?: boolean;
  fullWidth?: boolean;
}

export function Button({
  label,
  tone = 'primary',
  size = 'md',
  loading = false,
  haptic = true,
  fullWidth = false,
  disabled,
  onPress,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={
        isDisabled
          ? undefined
          : (event) => {
              if (haptic && process.env.EXPO_OS === 'ios') {
                Haptics.selectionAsync().catch(() => {});
              }
              onPress?.(event);
            }
      }
      disabled={isDisabled}
      hitSlop={size === 'sm' ? SM_HIT_SLOP : undefined}
      style={{ borderCurve: 'continuous' }}
      className={cn(
        'flex-row items-center justify-center gap-2',
        TONE[tone].view,
        SIZE[size].view,
        fullWidth && 'w-full',
        isDisabled && 'opacity-40',
        className
      )}
      {...props}>
      {loading ? (
        <ActivityIndicator size="small" />
      ) : (
        <Text className={cn(TONE[tone].label, SIZE[size].label)}>{label}</Text>
      )}
    </Pressable>
  );
}
