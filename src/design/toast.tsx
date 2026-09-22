import { useEffect, useState } from 'react';
import { Keyboard, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { cn } from './lib/cn';
import { Duration, Enter, Exit, Spring } from './motion';
import { Icon } from './icon';
import { useThemeColors } from './hooks/use-theme-colors';
import { Text } from './components/text';

export type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, tone?: ToastTone): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push(message, tone = 'info') {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (m: string) => useToastStore.getState().push(m, 'info'),
  success: (m: string) => useToastStore.getState().push(m, 'success'),
  error: (m: string) => useToastStore.getState().push(m, 'error'),
};

const TONE = {
  info: {
    border: 'border-line',
    icon: 'information-circle' as const,
    colour: 'content-muted' as const,
  },
  success: {
    border: 'border-success/50',
    icon: 'checkmark-circle' as const,
    colour: 'success' as const,
  },
  error: { border: 'border-danger/50', icon: 'alert-circle' as const, colour: 'danger' as const },
} as const;

const TAB_BAR_HEIGHT = 52;

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the keyboard moves, Android only after.
    const ios = process.env.EXPO_OS === 'ios';
    const show = ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hide = ios ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(show, (event) =>
      setHeight(event.endCoordinates?.height ?? 0)
    );
    const hidden = Keyboard.addListener(hide, () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}

function SwipeableToast({ toast: t }: { toast: Toast }) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const dismiss = useToastStore((s) => s.dismiss);

  const x = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onUpdate((event) => {
      x.set(event.translationX);
    })
    .onEnd((event) => {
      const far = Math.abs(event.translationX) > width * 0.25;
      const fast = Math.abs(event.velocityX) > 500;

      if (far || fast) {
        const direction = (event.translationX || event.velocityX) > 0 ? 1 : -1;
        x.set(
          withTiming(direction * width, { duration: Duration.fast }, () => {
            scheduleOnRN(dismiss, t.id);
          })
        );
        return;
      }

      x.set(withSpring(0, { ...Spring.press, velocity: event.velocityX }));
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
    opacity: 1 - Math.min(Math.abs(x.get()) / (width * 0.5), 1),
  }));

  return (
    <Animated.View
      entering={Enter.fromBottom()}
      exiting={Exit.fade()}
      className="w-full max-w-[520px]">
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityRole="alert"
          accessibilityLabel={t.message}
          accessibilityHint="Swipe left or right to dismiss"
          style={[
            style,
            {
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.14)',
              borderCurve: 'continuous',
            },
          ]}
          className={cn(
            'flex-row items-center gap-2.5 rounded-card border bg-surface-raised px-4 py-3',
            TONE[t.tone].border
          )}>
          <Icon name={TONE[t.tone].icon} size={18} color={colors[TONE[t.tone].colour]} />
          <Text variant="footnote" className="min-w-0 flex-1 text-content">
            {t.message}
          </Text>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  if (toasts.length === 0) return null;

  const bottom = Math.max(keyboard + 12, insets.bottom + TAB_BAR_HEIGHT + 12);

  return (
    <View
      style={{ bottom, pointerEvents: 'box-none' }}
      className="absolute left-0 right-0 z-50 items-center gap-2 px-gutter">
      {toasts.map((t) => (
        <SwipeableToast key={t.id} toast={t} />
      ))}
    </View>
  );
}
