import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn, Icon, type IconName, Text, useThemeColors } from '@/design';
import { QUICK_REACTIONS } from '@/core/messaging/reactions';

export interface MessageAction {
  id: string;
  label: string;
  icon: IconName;
  tone?: 'default' | 'danger';
  onPress: () => void;
}

export interface MessageAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const REACTION_BAR_HEIGHT = 52;
const MENU_ROW_HEIGHT = 46;
const GAP = 8;

export function MessageActions({
  visible,
  anchor,
  fromMe,
  actions,
  onReact,
  onClose,
  render,
}: {
  visible: boolean;
  anchor: MessageAnchor | null;
  fromMe: boolean;
  actions: MessageAction[];
  onReact?: (emoji: string) => void;
  onClose: () => void;
  render: () => React.ReactNode;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [visible]);

  if (!anchor) return null;

  const menuHeight = actions.length * MENU_ROW_HEIGHT + 16;
  const wanted = REACTION_BAR_HEIGHT + GAP + anchor.height + GAP + menuHeight;
  const top = insets.top + 8;
  const bottom = screenHeight - insets.bottom - 8;

  const naturalTop = anchor.y - REACTION_BAR_HEIGHT - GAP;
  const groupTop = Math.max(top, Math.min(naturalTop, bottom - wanted));
  const scrolls = wanted > bottom - top;

  const group = (
    <View style={{ width: '100%' }}>
      {onReact ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(100)}
          className={cn('px-gutter pb-2', fromMe ? 'items-end' : 'items-start')}>
          <View
            style={{ borderCurve: 'continuous' }}
            className="flex-row items-center gap-1 rounded-pill bg-surface-raised px-2 py-1.5 shadow-sm">
            {QUICK_REACTIONS.map((emoji) => (
              <RNPressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
                onPress={() => {
                  onReact(emoji);
                  onClose();
                }}
                className="h-9 w-9 items-center justify-center rounded-pill active:bg-surface-sunken">
                <Text className="text-[24px]">{emoji}</Text>
              </RNPressable>
            ))}
          </View>
        </Animated.View>
      ) : null}

      <View style={{ pointerEvents: 'none' }}>{render()}</View>

      <Animated.View
        entering={FadeIn.duration(140).delay(30)}
        exiting={FadeOut.duration(100)}
        className={cn('px-gutter pt-2', fromMe ? 'items-end' : 'items-start')}>
        <View
          style={{ borderCurve: 'continuous', minWidth: 200 }}
          className="overflow-hidden rounded-card bg-surface-raised py-1 shadow-sm">
          {actions.map((action) => (
            <RNPressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              className="min-h-[46px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface-sunken">
              <Icon
                name={action.icon}
                size={20}
                color={action.tone === 'danger' ? colors.danger : colors.content}
              />
              <Text className={cn('font-medium', action.tone === 'danger' && 'text-danger')}>
                {action.label}
              </Text>
            </RNPressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        style={{ flex: 1 }}>
        <BlurView
          intensity={40}
          tint={colors.scheme === 'dark' ? 'dark' : 'light'}
          style={{ flex: 1 }}>
          <RNPressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />

          {scrolls ? (
            <ScrollView
              contentContainerStyle={{ paddingTop: top, paddingBottom: screenHeight - bottom }}
              showsVerticalScrollIndicator={false}>
              {group}
            </ScrollView>
          ) : (
            <View
              style={{
                pointerEvents: 'box-none',
                position: 'absolute',
                left: 0,
                right: 0,
                top: groupTop,
              }}>
              {group}
            </View>
          )}
        </BlurView>
      </Animated.View>
    </Modal>
  );
}
