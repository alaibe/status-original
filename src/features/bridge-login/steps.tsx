import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Field, Pressable, Text, useThemeColors, cn } from '@/design';
import type { InputField, LoginStep } from '@/protocols/matrix/provisioning';

export function InputStep({
  step,
  busy,
  onSubmit,
}: {
  step: LoginStep;
  busy: boolean;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const fields = step.user_input?.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, field.default_value ?? '']))
  );
  const ready = fields.every((field) => valid(field, values[field.id] ?? ''));
  const submit = () => {
    if (ready && !busy) onSubmit(values);
  };

  return (
    <View className="gap-3">
      {fields.map((field, index) =>
        field.type === 'select' ? (
          <View key={field.id} className="gap-2">
            <Text variant="footnote" className="font-semibold">
              {field.name}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(field.options ?? []).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  onPress={() => setValues((current) => ({ ...current, [field.id]: option }))}
                  className={cn(
                    'rounded-pill border px-3 py-1.5',
                    values[field.id] === option ? 'border-brand bg-brand-soft' : 'border-line'
                  )}>
                  <Text variant="footnote">{option}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <Field
            key={field.id}
            testID={`bridge-login-${field.id}`}
            label={field.name}
            hint={field.description}
            value={values[field.id] ?? ''}
            onChangeText={(text) => setValues((current) => ({ ...current, [field.id]: text }))}
            onSubmitEditing={submit}
            autoFocus={index === 0}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            secureTextEntry={field.type === 'password'}
            keyboardType={KEYBOARD[field.type] ?? 'default'}
            autoComplete={AUTOCOMPLETE[field.type]}
          />
        )
      )}
      <Button
        testID="bridge-login-submit"
        label="Continue"
        size="md"
        fullWidth
        loading={busy}
        disabled={!ready}
        onPress={submit}
      />
    </View>
  );
}

export function WaitStep({ step }: { step: LoginStep }) {
  const colors = useThemeColors();
  const display = step.display_and_wait;

  return (
    <View className="items-center gap-4">
      {display?.type === 'qr' && display.data ? (
        <View className="rounded-card bg-white p-4">
          <QRCode value={display.data} size={220} backgroundColor="#ffffff" color="#000000" />
        </View>
      ) : display?.data ? (
        <Text variant="title" className="text-center" selectable>
          {display.data}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <ActivityIndicator color={colors['content-muted']} />
        <Text variant="caption">Waiting…</Text>
      </View>
    </View>
  );
}

function valid(field: InputField, value: string): boolean {
  if (!value) return false;
  if (!field.pattern) return true;
  try {
    return new RegExp(field.pattern).test(value);
  } catch {
    return true;
  }
}

const KEYBOARD: Partial<
  Record<InputField['type'], 'email-address' | 'phone-pad' | 'number-pad' | 'url'>
> = {
  email: 'email-address',
  phone_number: 'phone-pad',
  url: 'url',
};

const AUTOCOMPLETE: Partial<
  Record<InputField['type'], 'email' | 'tel' | 'password' | 'username' | 'one-time-code'>
> = {
  email: 'email',
  phone_number: 'tel',
  password: 'password',
  username: 'username',
  '2fa_code': 'one-time-code',
};
