import { useColorScheme } from 'nativewind';

import { colorsFor, type ResolvedColors, type ThemeName } from '../tokens';

export type ThemeColors = ResolvedColors & { scheme: ThemeName };

const THEMES: Record<ThemeName, ThemeColors> = {
  light: { ...colorsFor('light'), scheme: 'light' },
  dark: { ...colorsFor('dark'), scheme: 'dark' },
};

/**
 * The JavaScript half of the palette `className` resolves from, so the two
 * have to agree. React Native's `useColorScheme` reports the OS setting, which
 * differs from the in-app choice whenever Settings overrides it; NativeWind's
 * reflects what the app set, override included.
 */
export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return THEMES[colorScheme === 'dark' ? 'dark' : 'light'];
}
