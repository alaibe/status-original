import { View } from 'react-native';

import { useState } from 'react';

import { ActionSheet, Badge, Button, Eyebrow, Pressable, Text } from '../components';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Icon } from '../icon';
import { cn } from '../lib/cn';
import { copyText } from '../copy-text';
import { FormWidget } from './form-widget';
import { type Widget, type WidgetAction, type WidgetTone } from './schema';

export interface WidgetViewProps {
  widget: Widget;
  onCommand?: (command: string) => void;
  onOpenUrl?: (url: string) => void;
  onOffer?: (heading: { title: string; subtitle?: string }, actions: WidgetAction[]) => void;
}

const TEXT_TONE: Record<WidgetTone, string> = {
  neutral: 'text-content',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const CARD_TONE: Record<WidgetTone, string> = {
  neutral: 'border-line bg-surface-raised',
  brand: 'border-brand/40 bg-brand-soft',
  success: 'border-success/40 bg-success/10',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-danger/40 bg-danger/10',
};

export function WidgetView(props: WidgetViewProps) {
  const [offer, setOffer] = useState<{
    title: string;
    subtitle?: string;
    actions: WidgetAction[];
  } | null>(null);

  return (
    <>
      <WidgetNode
        {...props}
        onOffer={(heading, actions) => {
          if (actions.length === 1 && actions[0].tone !== 'danger') {
            props.onCommand?.(actions[0].command);
            return;
          }
          setOffer({ ...heading, actions });
        }}
      />

      <ActionSheet
        visible={offer !== null}
        onClose={() => setOffer(null)}
        title={offer?.title}
        subtitle={offer?.subtitle}
        actions={(offer?.actions ?? []).map((action) => ({
          label: action.label,
          icon: action.icon,
          tone: action.tone,
          onPress: () => props.onCommand?.(action.command),
        }))}
      />
    </>
  );
}

/**
 * Never an arrow and never an ellipsis: both promise a destination, and a row
 * either runs its action on the spot or opens a sheet of its own actions.
 */
function affordanceFor(actions: WidgetAction[] | undefined): string | null {
  if (!actions?.length) return null;
  return actions.length === 1 ? actions[0].label : 'Options';
}

function Affordance({
  actions,
  tint,
}: {
  actions: WidgetAction[] | undefined;
  tint: (tone: WidgetTone | undefined) => string;
}) {
  const label = affordanceFor(actions);
  if (!label || !actions?.length) return null;

  // Only ever a glyph an action asked for, and only the primary one (the
  // first). A generic "…" would read as "opens something" when what opens is
  // a sheet of the actions the row already has; a named icon at least says
  // which one leads.
  const primary = actions[0];
  if (primary.icon) {
    return (
      <View className="h-7 w-7 items-center justify-center rounded-pill bg-surface-sunken">
        <Icon name={primary.icon} size={15} color={tint(primary.tone)} />
      </View>
    );
  }

  const single = actions.length === 1 ? actions[0] : undefined;

  return (
    <Text
      numberOfLines={1}
      className={cn(
        'shrink-0 text-footnote font-medium',
        single?.tone === 'danger' ? 'text-danger' : 'text-brand'
      )}>
      {label}
    </Text>
  );
}

function StateDot({ state }: { state: 'on' | 'off' }) {
  return (
    <View
      className={cn(
        'h-2 w-2 shrink-0 rounded-pill',
        state === 'on' ? 'bg-success' : 'bg-content-subtle/40'
      )}
    />
  );
}

function WidgetNode({ widget, onCommand, onOpenUrl, onOffer }: WidgetViewProps) {
  const colors = useThemeColors();

  const tint = (tone: WidgetTone | undefined) => (tone === 'danger' ? colors.danger : colors.brand);

  switch (widget.kind) {
    case 'stat': {
      const body = (
        <View className="gap-0.5">
          {widget.label ? <Text variant="caption">{widget.label}</Text> : null}
          <Text
            className={cn(
              'text-[1.625rem] font-semibold tracking-tight tabular-nums',
              TEXT_TONE[widget.tone ?? 'neutral']
            )}>
            {widget.value}
          </Text>
          {widget.caption ? <Text variant="caption">{widget.caption}</Text> : null}
        </View>
      );

      if (!widget.actions?.length) return body;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={affordanceFor(widget.actions) ?? undefined}
          pressScale={0.99}
          onPress={() =>
            onOffer?.(
              widget.label
                ? { title: widget.label, subtitle: widget.value }
                : { title: widget.value },
              widget.actions ?? []
            )
          }
          className="flex-row items-center justify-between gap-2">
          <View className="flex-1">{body}</View>
          <Affordance actions={widget.actions} tint={tint} />
        </Pressable>
      );
    }

    case 'rows':
      return (
        <View className="gap-1.5">
          {widget.rows.map((row, i) => {
            const content = (
              <View className={cn('flex-row gap-3', row.state ? 'items-center' : 'items-baseline')}>
                {row.state ? <StateDot state={row.state} /> : null}
                <Text
                  variant="caption"
                  className={cn(row.state ? 'grow shrink' : 'shrink-0')}
                  numberOfLines={1}>
                  {row.label}
                </Text>
                {row.value ? (
                  <Text
                    numberOfLines={1}
                    className={cn(
                      'grow shrink text-right text-footnote font-medium tabular-nums',
                      TEXT_TONE[row.tone ?? 'neutral']
                    )}>
                    {row.value}
                  </Text>
                ) : null}
                <View className="pl-2">
                  <Affordance actions={row.actions} tint={tint} />
                </View>
              </View>
            );

            if (!row.actions?.length) return <View key={`${row.label}-${i}`}>{content}</View>;

            return (
              <Pressable
                key={`${row.label}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`${row.label}, ${row.value}`}
                accessibilityHint={affordanceFor(row.actions) ?? undefined}
                pressScale={0.99}
                onPress={() =>
                  onOffer?.(
                    { title: row.label, subtitle: row.value || undefined },
                    row.actions ?? []
                  )
                }
                className="-mx-1 rounded-field px-1 py-0.5 active:bg-surface-sunken">
                {content}
              </Pressable>
            );
          })}
        </View>
      );

    case 'list':
      return (
        <View className="gap-1">
          {widget.items.map((item, i) => {
            const body = (
              <View className="flex-row items-center gap-2.5 py-2">
                {item.state ? <StateDot state={item.state} /> : null}
                {item.icon ? (
                  <Icon name={item.icon} size={17} color={colors['content-muted']} />
                ) : null}
                <View className="min-w-0 grow shrink gap-0.5">
                  <Text
                    numberOfLines={1}
                    className={cn(
                      'text-footnote font-semibold',
                      TEXT_TONE[item.tone ?? 'neutral']
                    )}>
                    {item.title}
                  </Text>
                  {item.subtitle ? (
                    <Text variant="caption" numberOfLines={2}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                {item.status ? (
                  <Badge label={item.status} tone={item.tone === 'brand' ? 'brand' : 'neutral'} />
                ) : null}
                <View className="pl-2">
                  <Affordance actions={item.actions} tint={tint} />
                </View>
              </View>
            );

            if (!item.actions?.length) return <View key={`${item.title}-${i}`}>{body}</View>;

            return (
              <Pressable
                key={`${item.title}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={item.subtitle ? `${item.title}, ${item.subtitle}` : item.title}
                accessibilityHint={affordanceFor(item.actions) ?? undefined}
                pressScale={0.99}
                onPress={() =>
                  onOffer?.({ title: item.title, subtitle: item.subtitle }, item.actions ?? [])
                }
                className="-mx-1.5 rounded-field px-1.5 active:bg-surface-sunken">
                {body}
              </Pressable>
            );
          })}
        </View>
      );

    case 'text':
      return <Text variant="footnote">{widget.text}</Text>;

    case 'code': {
      const body = (
        <View className="gap-0.5">
          {widget.label ? <Text variant="caption">{widget.label}</Text> : null}
          <View className="flex-row items-center gap-1.5">
            <Text variant="mono" numberOfLines={1} className="flex-1">
              {widget.value}
            </Text>
            {widget.copyable ? (
              <Icon name="copy-outline" size={13} color={colors['content-subtle']} />
            ) : null}
          </View>
        </View>
      );

      if (!widget.copyable) return body;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${widget.label ?? 'value'}`}
          pressScale={0.99}
          onPress={() => void copyText(widget.value)}>
          {body}
        </Pressable>
      );
    }

    case 'card':
      return (
        <View
          className={cn(
            'gap-2.5 rounded-bubble border p-3.5',
            CARD_TONE[widget.tone ?? 'neutral']
          )}>
          {widget.title ? (
            <View className="flex-row items-center gap-1.5">
              {widget.icon ? (
                <Icon
                  name={widget.icon}
                  size={15}
                  color={
                    widget.tone === 'neutral' || !widget.tone
                      ? colors['content-muted']
                      : colors.brand
                  }
                />
              ) : null}
              <Eyebrow>{widget.title}</Eyebrow>
            </View>
          ) : null}
          {widget.children.map((child, i) => (
            <WidgetNode
              key={i}
              widget={child}
              onCommand={onCommand}
              onOpenUrl={onOpenUrl}
              onOffer={onOffer}
            />
          ))}
        </View>
      );

    case 'badges':
      return (
        <View className="flex-row flex-wrap gap-1.5">
          {widget.badges.map((b, i) => (
            <Badge key={`${b.label}-${i}`} label={b.label} tone={b.tone ?? 'neutral'} />
          ))}
        </View>
      );

    case 'actions':
      return (
        <View className="flex-row flex-wrap gap-2">
          {widget.actions.map((action, i) => (
            <Button
              key={`${action.label}-${i}`}
              label={action.label}
              size="sm"
              tone={action.tone}
              onPress={() => onCommand?.(action.command)}
            />
          ))}
        </View>
      );

    case 'form':
      return <FormWidget widget={widget} onCommand={onCommand} />;

    case 'link':
      return (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={widget.label}
          onPress={() => onOpenUrl?.(widget.url)}
          className="flex-row items-center gap-1.5">
          <Icon name={widget.icon ?? 'open-outline'} size={14} color={colors.brand} />
          <Text className="min-w-0 flex-1 text-footnote font-medium text-brand">
            {widget.label}
          </Text>
        </Pressable>
      );
  }
}
