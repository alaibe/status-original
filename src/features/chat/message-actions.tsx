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

import { cn, Icon, type IconName, PASS_THROUGH, Text, useThemeColors } from '@/design';
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

const REACTION_BAR_HEIGHT = 48;
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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [visible]);

  if (!anchor) return null;

  const above = onReact ? REACTION_BAR_HEIGHT + GAP : 0;
  const menuHeight = actions.length * MENU_ROW_HEIGHT + 16;
  const wanted = above + anchor.height + GAP + menuHeight;
  const top = insets.top + 8;
  const bottom = screenHeight - insets.bottom - 8;

  const groupTop = Math.max(top, Math.min(anchor.y - above, bottom - wanted));
  const scrolls = wanted > bottom - top;

  const backdrop = (
    <RNPressable
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onPress={onClose}
      style={StyleSheet.absoluteFill}
    />
  );

  const group = (
    <View
      style={[
        PASS_THROUGH,
        {
          gap: GAP,
          alignItems: fromMe ? 'flex-end' : 'flex-start',
          paddingLeft: fromMe ? GAP : anchor.x,
          paddingRight: fromMe ? Math.max(GAP, screenWidth - anchor.x - anchor.width) : GAP,
        },
        !scrolls && { position: 'absolute', left: 0, right: 0, top: groupTop },
      ]}>
      {onReact ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)}>
          <View
            style={{ borderCurve: 'continuous', height: REACTION_BAR_HEIGHT }}
            className="flex-row items-center gap-1 rounded-pill bg-surface-raised px-2 shadow-sm">
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

      <View style={{ pointerEvents: 'none', width: anchor.width }}>{render()}</View>

      <Animated.View entering={FadeIn.duration(140).delay(30)} exiting={FadeOut.duration(100)}>
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
          {scrolls ? (
            <ScrollView
              contentContainerStyle={{ paddingTop: top, paddingBottom: screenHeight - bottom }}
              showsVerticalScrollIndicator={false}>
              {backdrop}
              {group}
            </ScrollView>
          ) : (
            <>
              {backdrop}
              {group}
            </>
          )}
        </BlurView>
      </Animated.View>
    </Modal>
  );
}
