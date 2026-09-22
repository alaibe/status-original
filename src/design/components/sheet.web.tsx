import { useState } from 'react';
import { Modal, Pressable as RNPressable, useWindowDimensions, View } from 'react-native';
import { create } from 'zustand';

import { useEscapeKey } from '../lib/escape-key';
import { useLayoutInsets } from '../lib/layout-insets';
import { IconButton } from './icon-button';
import type { SheetProps } from './sheet';
import { Text } from './text';

export type { SheetProps } from './sheet';

interface SheetState {
  current: null;
  afterClose: (() => void) | null;
}

/** Nothing animates natively here; kept so the phone's sheet route type-checks. */
export const SHEET_DISMISS_MS = 0;

export const useSheetStore = create<SheetState>(() => ({ current: null, afterClose: null }));

export function closeSheetThen(sheet: Pick<SheetProps, 'onClose'>, action: () => void) {
  sheet.onClose();
  action();
}

const WIDTH = 320;
const MARGIN = 12;

/**
 * On desktop a sheet is a popover: at the pointer when a right-click opened it,
 * centred when a button did. Esc and the backdrop close it.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  leading,
  anchor,
  children,
  onClose,
}: SheetProps) {
  const window = useWindowDimensions();
  const insets = useLayoutInsets();
  const [size, setSize] = useState({ width: WIDTH, height: 0 });

  useEscapeKey(visible, onClose);

  if (!visible) return null;

  const placement = anchor
    ? {
        left: Math.min(anchor.x, window.width - size.width - MARGIN),
        top: Math.min(anchor.y, window.height - size.height - MARGIN),
      }
    : {
        left: insets.left + (window.width - insets.left - size.width) / 2,
        top: Math.max(MARGIN, (window.height - size.height) / 2),
      };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <RNPressable
        accessibilityLabel="Close"
        onPress={onClose}
        className={anchor ? 'flex-1' : 'flex-1 bg-content/20'}>
        <View
          onLayout={(event) => setSize(event.nativeEvent.layout)}
          onStartShouldSetResponder={() => true}
          style={[placement, { width: WIDTH, position: 'absolute' }]}
          className="rounded-card border border-line bg-surface p-2 shadow-lg">
          {title || subtitle || leading ? (
            <View className="min-h-tap flex-row items-center gap-3 px-2 py-1.5">
              {leading}
              <View className="min-w-0 flex-1">
                {title ? (
                  <Text variant="title" numberOfLines={1}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text variant="caption" numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {anchor ? null : (
                <IconButton icon="close" label="Close" size={18} onPress={onClose} />
              )}
            </View>
          ) : null}
          <View className="gap-3">{children}</View>
        </View>
      </RNPressable>
    </Modal>
  );
}
