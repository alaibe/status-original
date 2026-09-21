import { useSegments } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { View } from 'react-native';

import { ChatBackground, DRAG_REGION, LayoutInsetsContext } from '@/design';
import { useAppearanceStore } from '@/core/app/appearance';

import { DesktopSidebar } from './desktop-sidebar';
import { QuickSwitcher } from './quick-switcher';
import { FULL_WINDOW_ROUTES } from './routes';

/**
 * The window has no title bar, so its top edge moves it instead. Header
 * controls start below this line; the traffic lights are drawn over it.
 */
const DRAG_STRIP_HEIGHT = 24;

const FRAME_INSETS = { left: 8 + 320, top: DRAG_STRIP_HEIGHT };

function DragStrip() {
  return (
    <View
      {...DRAG_REGION}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DRAG_STRIP_HEIGHT, zIndex: 10 }}
    />
  );
}

/**
 * The wallpaper covers the whole window and the sidebar floats on it; the
 * conversation draws straight onto it, so the chat screen skips its own copy.
 */
export function AppFrame({ children }: PropsWithChildren) {
  const segments = useSegments();
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const first = segments[0];

  if (first === undefined || FULL_WINDOW_ROUTES.has(first)) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas p-6">
        <ChatBackground pattern={wallpaper} intensity="vivid" />
        <View
          style={{ borderCurve: 'continuous' }}
          className="h-[720px] max-h-full w-[520px] max-w-full overflow-hidden rounded-card bg-canvas shadow-xl">
          {children}
        </View>
        <DragStrip />
      </View>
    );
  }

  return (
    <LayoutInsetsContext.Provider value={FRAME_INSETS}>
      <View className="flex-1 flex-row bg-canvas">
        <ChatBackground pattern={wallpaper} intensity="vivid" />
        <View className="p-2 pr-0">
          <DesktopSidebar />
        </View>
        <View className="min-w-0 flex-1">{children}</View>
        <DragStrip />
        <QuickSwitcher />
      </View>
    </LayoutInsetsContext.Provider>
  );
}
