import { BlurView } from 'expo-blur';
import { Modal, Pressable as RNPressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from '../lib/cn';
import { Enter, Exit } from '../motion';
import { Text } from './text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({ visible, onClose, title, children, className }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={Enter.fade()} exiting={Exit.fade()} className="flex-1">
        {process.env.EXPO_OS === 'web' ? (
          <View className="absolute inset-0 bg-black/50" />
        ) : (
          <BlurView intensity={24} tint="dark" className="absolute inset-0" />
        )}

        <RNPressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="flex-1"
        />

        <Animated.View
          entering={Enter.sheet()}
          exiting={Exit.sheet()}
          style={{ paddingBottom: insets.bottom + 16 }}
          className={cn(
            'rounded-t-[28px] border-t border-line bg-surface-raised px-gutter pt-2',
            className
          )}>
          <View className="mb-3 h-1 w-10 self-center rounded-pill bg-line-strong" />
          {title ? (
            <Text variant="title" className="mb-3">
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
