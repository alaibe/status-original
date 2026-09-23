import { EmptyState, ToastHost, useThemeColors } from '@/design';
import '@/global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import {
  Observe,
  ObserveRoot,
  useObserve,
  type ObserveErrorBoundaryFallbackProps,
} from 'expo-observe';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme as useSystemColorScheme, View } from 'react-native';
import { colorScheme as nativewindColorScheme } from 'nativewind';

import { useEffect, useSyncExternalStore } from 'react';

import { useAppearanceStore } from '@/core/app/appearance';
import { useAppBoot, useAppLock, useDeepLinkRouter } from '@/core/app/boot';
import { useMessageNotifications } from '@/core/app/use-notifications';
import { PluginProvider, usePluginHost } from '@/core/plugins/host';
import { LockGate } from '@/features/identity/lock-gate';
import { AppFrame } from '@/features/navigation/app-frame';
import { Dialog } from '@/features/navigation/dialog';
import { DIALOG_ROUTES } from '@/features/navigation/routes';
import { stackScreenOptions } from '@/features/navigation/stack-options';
import { ALL_PLUGINS, DEFAULT_ENABLED_PLUGINS } from '@/plugins';

Observe.configure({
  integrations: {
    'expo-router': { filteredParams: ['id'] },
  },
});

/**
 * On desktop every screen sits on the frame's wallpaper, so the navigator must
 * not paint its own background behind them.
 */
function navigationTheme(theme: typeof DefaultTheme): typeof DefaultTheme {
  if (process.env.EXPO_OS !== 'web') return theme;
  return { ...theme, colors: { ...theme.colors, background: 'transparent' } };
}

function RootLayout() {
  const system = useSystemColorScheme();
  const choice = useAppearanceStore((s) => s.theme);

  // One resolved scheme for both theming systems, so NativeWind and React Navigation cannot disagree.
  const scheme = choice === 'system' ? system : choice;
  useEffect(() => {
    nativewindColorScheme.set(scheme === 'dark' ? 'dark' : 'light');
  }, [scheme]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme(scheme === 'dark' ? DarkTheme : DefaultTheme)}>
          <PluginProvider plugins={ALL_PLUGINS} defaultEnabled={DEFAULT_ENABLED_PLUGINS}>
            <AppShell />
          </PluginProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Crashed({ resetError }: ObserveErrorBoundaryFallbackProps) {
  return (
    <View className="flex-1 bg-canvas">
      <EmptyState
        title="Something went wrong"
        description="This screen hit an error it could not recover from. Your account and messages are not affected."
        actionLabel="Try again"
        onAction={resetError}
      />
    </View>
  );
}

export default function Root() {
  return (
    <ObserveRoot errorBoundaryFallback={(props) => <Crashed {...props} />}>
      <RootLayout />
    </ObserveRoot>
  );
}

function PluginOverlays() {
  const { registry } = usePluginHost();
  const overlays = useSyncExternalStore(
    registry.subscribe,
    () => registry.overlays(),
    () => registry.overlays()
  );

  return (
    <>
      {overlays.map(({ overlay, pluginId }) => {
        const Overlay = overlay.component;
        return <Overlay key={`${pluginId}:${overlay.id}`} />;
      })}
    </>
  );
}

const desktop = process.env.EXPO_OS === 'web';

const SHEET_OPTIONS = {
  presentation: desktop ? 'transparentModal' : 'modal',
  animation: 'slide_from_bottom',
} as const;

function AppShell() {
  useAppBoot();
  useDeepLinkRouter();
  useMessageNotifications();

  const lockStatus = useAppLock();
  const colors = useThemeColors();

  const { markInteractive } = useObserve();
  useEffect(() => {
    if (lockStatus === 'open') markInteractive();
  }, [lockStatus, markInteractive]);

  return (
    <View className="flex-1 bg-canvas">
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <AppFrame>
        <Stack
          screenOptions={{ headerShown: false, ...stackScreenOptions(colors) }}
          screenLayout={
            desktop
              ? ({ route, children }) =>
                  DIALOG_ROUTES.has(route.name) ? <Dialog>{children}</Dialog> : <>{children}</>
              : undefined
          }>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="profile/[id]"
            options={{
              animation: 'slide_from_right',
              presentation: desktop ? 'transparentModal' : 'card',
            }}
          />
          <Stack.Screen name="recover" options={{ animation: 'fade' }} />
          <Stack.Screen name="new-chat" options={SHEET_OPTIONS} />
          <Stack.Screen name="invite" options={SHEET_OPTIONS} />
          <Stack.Screen name="qr" options={SHEET_OPTIONS} />
          <Stack.Screen name="bridge-login" options={SHEET_OPTIONS} />
          <Stack.Screen
            name="sheet"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
        </Stack>
      </AppFrame>
      <PluginOverlays />
      <ToastHost />

      {lockStatus === 'open' ? null : lockStatus === 'locked' ? (
        <LockGate />
      ) : (
        <View className="absolute inset-0 bg-canvas" />
      )}
    </View>
  );
}
