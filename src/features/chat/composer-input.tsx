import { type Ref, useImperativeHandle, useRef } from 'react';
import { TextInput } from 'react-native';

export interface ComposerInputHandle {
  focus(): void;
}

export interface ComposerInputProps {
  ref?: Ref<ComposerInputHandle>;
  /** Markdown: what is sent, and what the composer sets for drafts and completions. */
  value: string;
  onChangeText(text: string): void;
  onSubmit(): void;
  onFile?(file: File): void;
  placeholder: string;
  placeholderColor: string;
}

export function ComposerInput({
  ref,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  placeholderColor,
}: ComposerInputProps) {
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  return (
    <TextInput
      testID="composer-input"
      ref={input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderColor}
      multiline
      numberOfLines={1}
      className="max-h-32 min-h-[42px] flex-1 py-2.5 pr-1 text-body text-content"
      returnKeyType="send"
      submitBehavior="submit"
      onSubmitEditing={onSubmit}
    />
  );
}
