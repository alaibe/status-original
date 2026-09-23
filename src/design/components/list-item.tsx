import { View } from 'react-native';

import { cn } from '../lib/cn';
import { contextMenu, type MenuAnchor } from '../lib/context-menu';
import { Pressable } from './pressable';
import { Text } from './text';

export interface ListItemProps {
  testID?: string;
  title: React.ReactNode;
  subtitle?: string;
  /** Beside the subtitle, at the end of the second line. */
  subtitleTrailing?: React.ReactNode;
  meta?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** A right-click on desktop; the long-press's counterpart. */
  onContextMenu?: (anchor: MenuAnchor) => void;
  /** The row whose content is open beside the list. */
  selected?: boolean;
  unread?: boolean;
  className?: string;
  numberOfLinesSubtitle?: number;
  /** Overrides the label built from `title` and `subtitle`. */
  accessibilityLabel?: string;
}

export function ListItem({
  testID,
  title,
  subtitle,
  subtitleTrailing,
  meta,
  leading,
  trailing,
  onPress,
  onLongPress,
  onContextMenu,
  selected = false,
  unread = false,
  className,
  numberOfLinesSubtitle = 1,
  accessibilityLabel,
}: ListItemProps) {
  const body = (
    <View className={cn('min-h-tap flex-row items-center gap-3 px-gutter py-2.5', className)}>
      {leading}
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            variant="title"
            numberOfLines={1}
            className={cn('min-w-0 flex-1 text-body font-semibold', unread && 'text-content')}>
            {title}
          </Text>
          {typeof meta === 'string' ? (
            <Text variant="caption" className={cn(unread && 'font-semibold text-brand')}>
              {meta}
            </Text>
          ) : (
            meta
          )}
        </View>
        {subtitle || subtitleTrailing ? (
          <View className="flex-row items-center gap-2">
            <Text
              variant="footnote"
              numberOfLines={numberOfLinesSubtitle}
              className={cn('min-w-0 flex-1', unread && 'font-medium text-content-muted')}>
              {subtitle}
            </Text>
            {subtitleTrailing}
          </View>
        ) : null}
      </View>
      {trailing}
    </View>
  );

  if (!onPress && !onLongPress) return body;

  /**
   * A pressable row is one accessibility element, so iOS stops exposing the
   * `Text` nodes inside it and VoiceOver would announce nothing. The label has
   * to be rebuilt from the parts.
   *
   * `title` can be a node (a contact row bolds the family name), and there is
   * nothing sensible to read out of one, so those keep whatever the caller
   * passed.
   */
  const label =
    accessibilityLabel ??
    (typeof title === 'string' ? [title, subtitle].filter(Boolean).join(', ') : undefined);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      {...(onContextMenu ? contextMenu(onContextMenu) : undefined)}
      pressScale={0.99}
      className={cn('mx-1 rounded-card active:bg-surface', selected && 'bg-brand-soft')}
      style={{ borderCurve: 'continuous' }}>
      {body}
    </Pressable>
  );
}
