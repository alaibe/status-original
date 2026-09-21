import { memo } from 'react';
import { Image, StyleSheet, View, type ImageURISource } from 'react-native';

import { useThemeColors } from '../hooks/use-theme-colors';
import {
  CHAT_PATTERNS,
  CHAT_PATTERN_SCALE,
  type ChatPatternName,
} from './chat-pattern-tile';

const SOURCES = Object.fromEntries(
  Object.entries(CHAT_PATTERNS).map(([name, uri]) => [
    name,
    { uri, scale: CHAT_PATTERN_SCALE } satisfies ImageURISource,
  ])
) as Record<ChatPatternName, ImageURISource>;

/**
 * Dark carries roughly twice the light opacity. The pattern is tinted with the
 * content colour, so in light it is near-black on white, where 5% is already a
 * visible mark, and in dark it is near-white on a canvas of rgb(9 9 13), where
 * the same figure disappears. Equal numbers would not look equal.
 */
const styles = StyleSheet.create({
  light: { position: 'absolute', inset: 0, opacity: 0.05 },
  dark: { position: 'absolute', inset: 0, opacity: 0.12 },
});

export interface ChatBackgroundProps {
  pattern?: ChatPatternName;
}

export const ChatBackground = memo(function ChatBackground({
  pattern = 'doodles',
}: ChatBackgroundProps) {
  const colors = useThemeColors();
  const isDark = colors.scheme === 'dark';

  return (
    <View style={{ pointerEvents: 'none' }} className="absolute inset-0 overflow-hidden">
      <View
        style={{
          position: 'absolute',
          inset: 0,
          // `surface-sunken` sits only five values from the canvas in dark, so a
          // gradient to it reads as a flat black rectangle.
          experimental_backgroundImage: isDark
            ? `linear-gradient(141deg, ${colors.surface} 0%, ${colors.canvas} 55%, ${colors.surface} 100%)`
            : `linear-gradient(141deg, ${colors['brand-soft']} 0%, ${colors.canvas} 55%, ${colors.surface} 100%)`,
        }}
      />

      <Image
        source={SOURCES[pattern]}
        resizeMode="repeat"
        tintColor={colors.content}
        style={isDark ? styles.dark : styles.light}
        fadeDuration={0}
        accessible={false}
      />
    </View>
  );
});
