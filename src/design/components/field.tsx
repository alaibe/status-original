import { TextInput, type TextInputProps, View } from 'react-native';

import { useThemeColors } from '../hooks/use-theme-colors';
import { cn } from '../lib/cn';
import { Text } from './text';

export interface FieldProps extends TextInputProps {
  ref?: React.Ref<TextInput>;
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
  containerClassName?: string;
}

export function Field({ label, hint, error, className, containerClassName, ...props }: FieldProps) {
  const colors = useThemeColors();

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="footnote">{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors['content-subtle']}
        style={{ borderCurve: 'continuous' }}
        className={cn(
          'min-h-tap rounded-field border bg-surface-raised px-3 py-2.5 text-body text-content',
          error ? 'border-danger' : 'border-line focus:border-brand',
          className
        )}
        {...props}
      />
      {error ? (
        <Text variant="caption" className="text-danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
