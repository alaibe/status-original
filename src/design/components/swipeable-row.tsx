import * as Haptics from 'expo-haptics';
import { useCallback, useRef } from 'react';
import { View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Pressable } from './pressable';
import { Text } from './text';
import { useThemeColors } from '../hooks/use-theme-colors';
import { Icon, type IconName } from '../icon';

export type SwipeTone = 'neutral' | 'warning' | 'brand' | 'danger';

export interface SwipeAction {
  id: string;
  label: string;
  icon: IconName;
  tone?: SwipeTone;
  destructive?: boolean;
  onPress(): void;
}

export interface SwipeableRowProps {
  right?: SwipeAction[];
  left?: SwipeAction[];
  children: React.ReactNode;
}

const ACTION_WIDTH = 76;
const ACTION_RADIUS = 14;

export function SwipeableRow({ right, left, children }: SwipeableRowProps) {
  const ref = useRef<SwipeableMethods>(null);

  const run = useCallback((action: SwipeAction) => {
    ref.current?.close();
    if (process.env.EXPO_OS === 'ios') {
      Haptics.impactAsync(
        action.destructive
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light
      ).catch(() => {});
    }
    action.onPress();
  }, []);

  const render = useCallback(
    (actions: SwipeAction[], side: 'left' | 'right') =>
      function SwipeActions() {
            return (
          <View className="flex-row items-stretch py-1 pl-1 pr-1">
            {actions.map((action, index) => (
              <ActionButton
                key={action.id}
                action={action}
                onRun={run}
                first={index === 0}
                last={index === actions.length - 1}
                side={side}
              />
            ))}
              </View>
            );
      },
    [run]
  );

  if (!right?.length && !left?.length) return <>{children}</>;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      leftThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      overshootLeft={false}
      renderRightActions={right?.length ? render(right, 'right') : undefined}
      renderLeftActions={left?.length ? render(left, 'left') : undefined}>
      {children}
    </ReanimatedSwipeable>
  );
}

function ActionButton({
  action,
  onRun,
  first,
  last,
  side,
}: {
  action: SwipeAction;
  onRun(action: SwipeAction): void;
  first: boolean;
  last: boolean;
  side: 'left' | 'right';
}) {
  const colors = useThemeColors();
  const tone: SwipeTone = action.tone ?? (action.destructive ? 'danger' : 'neutral');

  const fill = {
    neutral: colors['content-muted'],
    warning: colors.warning,
    brand: colors.brand,
    danger: colors.danger,
  }[tone];

  const content = colors['brand-on'];

  const outer = side === 'right' ? last : first;
  const inner = side === 'right' ? first : last;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={() => onRun(action)}
      pressScale={1}
      style={{
        width: ACTION_WIDTH,
        backgroundColor: fill,
        borderCurve: 'continuous',
        borderTopLeftRadius: side === 'right' ? (inner ? ACTION_RADIUS : 0) : outer ? ACTION_RADIUS : 0,
        borderBottomLeftRadius: side === 'right' ? (inner ? ACTION_RADIUS : 0) : outer ? ACTION_RADIUS : 0,
        borderTopRightRadius: side === 'right' ? (outer ? ACTION_RADIUS : 0) : inner ? ACTION_RADIUS : 0,
        borderBottomRightRadius: side === 'right' ? (outer ? ACTION_RADIUS : 0) : inner ? ACTION_RADIUS : 0,
        marginLeft: side === 'right' && !first ? 2 : 0,
        marginRight: side === 'left' && !last ? 2 : 0,
      }}
      className="items-center justify-center gap-1">
      <Icon name={action.icon} size={21} color={content} />
      <Text variant="micro" style={{ color: content }} numberOfLines={1}>
        {action.label}
      </Text>
    </Pressable>
  );
}
