import { Pressable as RNPressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Spring } from '../motion';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

export interface PressScaleProps extends PressableProps {
  pressScale?: number;
  className?: string;
}

export function Pressable({
  pressScale = 0.985,
  onPressIn,
  onPressOut,
  ...props
}: PressScaleProps) {
  const scale = useSharedValue(1);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handleIn = (e: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) => {
    scale.set(withSpring(pressScale, Spring.press));
    onPressIn?.(e);
  };

  const handleOut = (e: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) => {
    scale.set(withSpring(1, Spring.press));
    onPressOut?.(e);
  };

  return <AnimatedPressable style={style} onPressIn={handleIn} onPressOut={handleOut} {...props} />;
}
