import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionSheet,
  Button,
  Field,
  FieldShell,
  FIELD_BOX,
  MANY_OPTIONS,
  Pressable,
  Text,
} from '../components';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Icon } from '../icon';
import { cn } from '../lib/cn';
import {
  displayValues,
  fillCommand,
  fillText,
  resolveValues,
  visibleOptions,
  type Widget,
  type WidgetField,
} from './schema';

function SelectField({
  field,
  answers,
  display,
  onPick,
}: {
  field: WidgetField;
  answers: Record<string, string>;
  display: Record<string, string>;
  onPick: (value: string) => void;
}) {
  const colors = useThemeColors();
  const [picking, setPicking] = useState(false);

  const label = fillText(field.label, display);
  const options = visibleOptions(field, answers);
  const chosen = options.find((option) => option.value === answers[field.id]);

  return (
    <FieldShell label={label} hint={field.hint ? fillText(field.hint, display) : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${chosen?.label ?? 'none chosen'}`}
        onPress={() => setPicking(true)}
        style={{ borderCurve: 'continuous' }}
        className={cn(FIELD_BOX, 'flex-row items-center gap-2 border-line')}>
        <Text
          className={cn(
            'min-w-0 flex-1 text-body',
            chosen ? 'text-content' : 'text-content-subtle'
          )}>
          {chosen?.label ?? field.placeholder ?? 'Choose'}
        </Text>
        <Icon name="chevron-down" size={16} color={colors['content-subtle']} />
      </Pressable>

      <ActionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title={label}
        searchFor={label.toLowerCase()}
        actions={
          picking
            ? options.map((option) => ({
                label: option.label,
                selected: option.value === answers[field.id],
                onPress: () => onPick(option.value),
              }))
            : []
        }
      />
    </FieldShell>
  );
}

export function FormWidget({
  widget,
  onCommand,
}: {
  widget: Extract<Widget, { kind: 'form' }>;
  onCommand?: (command: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(widget.fields.map((f) => [f.id, f.value ?? '']))
  );

  const answers = resolveValues(widget.fields, values);
  const display = displayValues(widget.fields, answers);
  const missing = widget.fields.some((f) => !f.optional && !answers[f.id]?.trim());

  return (
    <View className="gap-3" style={{ minWidth: 260 }}>
      {widget.fields.map((field) =>
        field.options && (field.select || visibleOptions(field, answers).length >= MANY_OPTIONS) ? (
          <SelectField
            key={field.id}
            field={field}
            answers={answers}
            display={display}
            onPick={(value) => setValues({ ...answers, [field.id]: value })}
          />
        ) : field.options ? (
          <View key={field.id} className="gap-1.5">
            <Text variant="caption">{fillText(field.label, display)}</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {visibleOptions(field, answers).map((option) => {
                const picked = answers[field.id] === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: picked }}
                    accessibilityLabel={option.label}
                    onPress={() => setValues({ ...answers, [field.id]: option.value })}
                    style={{ borderCurve: 'continuous' }}
                    className={cn(
                      'rounded-pill border px-3 py-1.5',
                      picked ? 'border-brand bg-brand' : 'border-line bg-surface'
                    )}>
                    <Text
                      variant="caption"
                      className={picked ? 'font-semibold text-brand-on' : 'text-content'}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {field.hint ? <Text variant="micro">{fillText(field.hint, display)}</Text> : null}
          </View>
        ) : (
          <Field
            key={field.id}
            label={fillText(field.label, display)}
            hint={field.hint ? fillText(field.hint, display) : undefined}
            placeholder={field.placeholder ? fillText(field.placeholder, display) : undefined}
            defaultValue={field.value ?? ''}
            onChangeText={(text) => setValues({ ...answers, [field.id]: text })}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType={field.keyboard === 'decimal' ? 'decimal-pad' : 'default'}
          />
        )
      )}
      <Button
        label={widget.submit.label}
        size="sm"
        disabled={missing}
        tone={widget.submit.tone}
        onPress={() => onCommand?.(fillCommand(widget.submit.command, answers))}
      />
    </View>
  );
}
