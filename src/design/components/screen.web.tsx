import { View } from 'react-native';

import { cn } from '../lib/cn';
import type { ScreenProps } from './screen';

export type { ScreenProps } from './screen';

/**
 * On desktop a screen sits inside a pane card or a dialog that already has a
 * background, so this only centres the content column; `edges` is a phone's
 * notch and home indicator, which a window has neither of.
 */
export function Screen({ className, children, edges: _edges, ...props }: ScreenProps) {
  return (
    <View className="flex-1">
      <View className={cn('mx-auto w-full max-w-[720px] flex-1', className)} {...props}>
        {children}
      </View>
    </View>
  );
}
