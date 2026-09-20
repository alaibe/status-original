import type { ViewProps } from 'react-native';
import { View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { cn } from '../lib/cn';

export interface ScreenProps extends ViewProps {
  className?: string;
  edges?: readonly Edge[];
}

export function Screen({ className, children, edges = ['top'], ...props }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-canvas">
      <View className={cn('mx-auto w-full max-w-[720px] flex-1', className)} {...props}>
        {children}
      </View>
    </SafeAreaView>
  );
}
