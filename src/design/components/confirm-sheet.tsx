import { View } from 'react-native';

import { Button } from './button';
import { Sheet } from './sheet';
import { Text } from './text';

export interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** One paragraph, or several. Each becomes its own line of body copy. */
  body?: string | (string | undefined)[];
  confirm: {
    label: string;
    /** Shown in place of `label` while `busy`. */
    busyLabel?: string;
    /** `danger` for anything that destroys something. Primary otherwise. */
    tone?: 'primary' | 'danger';
    testID?: string;
    onPress: () => void;
  };
  cancelLabel?: string;
  /** Disables both buttons and puts the confirm button in its loading state. */
  busy?: boolean;
}

/**
 * Cancel is `neutral`, never ghost: on a dialog whose other button destroys
 * something, the safe way out should not be the faintest thing on screen.
 *
 * The copy stays the caller's. What is lost differs every time, and a generic
 * "are you sure?" is what these sheets exist to avoid.
 */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  body,
  confirm,
  cancelLabel = 'Cancel',
  busy = false,
}: ConfirmSheetProps) {
  const paragraphs = (Array.isArray(body) ? body : [body]).filter(Boolean) as string[];

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View className="gap-3 pb-2">
        {paragraphs.map((paragraph) => (
          <Text key={paragraph} variant="footnote">
            {paragraph}
          </Text>
        ))}
        <Button
          testID={confirm.testID}
          label={busy ? (confirm.busyLabel ?? confirm.label) : confirm.label}
          tone={confirm.tone ?? 'primary'}
          fullWidth
          loading={busy}
          disabled={busy}
          onPress={confirm.onPress}
        />
        <Button
          label={cancelLabel}
          tone="neutral"
          fullWidth
          disabled={busy}
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}
