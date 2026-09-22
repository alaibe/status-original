import { useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';

import { useEscapeKey } from '@/design';

import { MediaPanelContent, type MediaPanelProps, type MediaTab } from './media-panel-content';

export type { MediaAnchor, MediaPanelProps } from './media-panel-content';

const WIDTH = 380;
const HEIGHT = 460;
const MARGIN = 12;

/** On the desktop the panel is a popover above the button that opened it. */
export function MediaPanel({ tab: initialTab, anchor, onClose, onEmoji, onGif }: MediaPanelProps) {
  const window = useWindowDimensions();
  const [tab, setTab] = useState<MediaTab>(initialTab);
  useEscapeKey(true, onClose);

  const right = anchor ? Math.max(MARGIN, window.width - (anchor.x + anchor.width)) : MARGIN;
  const bottom = anchor ? Math.max(MARGIN, window.height - anchor.y + 8) : MARGIN;
  const height = Math.min(HEIGHT, window.height - bottom - MARGIN);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1" />
      <View
        style={{
          position: 'absolute',
          right,
          bottom,
          width: WIDTH,
          height,
          borderCurve: 'continuous',
        }}
        className="overflow-hidden rounded-card border border-line bg-surface-raised shadow-xl">
        <MediaPanelContent
          tab={tab}
          onTab={setTab}
          onEmoji={onEmoji}
          onGif={(content) => {
            onGif(content);
            onClose();
          }}
          autoFocusSearch
        />
      </View>
    </Modal>
  );
}
