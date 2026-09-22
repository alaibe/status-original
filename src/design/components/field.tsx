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

/** Worn by anything that has to look like a field. */
export const FIELD_BOX = 'min-h-tap rounded-field border bg-surface-raised px-3 py-2.5';

/** The control is the input below, or a pressable where a value is chosen. */
export function FieldShell({
  label,
  hint,
  error,
  containerClassName,
  children,
}: Pick<FieldProps, 'label' | 'hint' | 'error' | 'containerClassName'> & {
  children: React.ReactNode;
}) {
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="footnote">{label}</Text> : null}
      {children}
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

export function Field({ label, hint, error, className, containerClassName, ...props }: FieldProps) {
  const colors = useThemeColors();

  return (
    <FieldShell label={label} hint={hint} error={error} containerClassName={containerClassName}>
      <TextInput
        placeholderTextColor={colors['content-subtle']}
        style={{ borderCurve: 'continuous' }}
        className={cn(
          FIELD_BOX,
          'text-body text-content',
          error ? 'border-danger' : 'border-line focus:border-brand',
          className
        )}
        {...props}
      />
    </FieldShell>
  );
}
