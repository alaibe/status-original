import { Stack } from 'expo-router';

import { useThemeColors } from '@/design';

import { PaneCard } from './pane-card';
import { stackScreenOptions } from './stack-options';

const desktop = process.env.EXPO_OS === 'web';

/** Panes that only wait for the sidebar to pick something. */
const PLACEHOLDERS = new Set(['chats', 'contacts', 'settings/index']);

export function TabStack() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        // On desktop the sidebar is the way back and the page draws its own title.
        headerShown: !desktop,
        headerTransparent: false,
        ...stackScreenOptions(colors),
      }}
      screenLayout={
        desktop
          ? ({ route, options, children }) =>
              PLACEHOLDERS.has(route.name) ? (
                <>{children}</>
              ) : (
                <PaneCard title={options.title}>{children}</PaneCard>
              )
          : undefined
      }
    />
  );
}
