import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable as RNPressable, View, useWindowDimensions } from 'react-native';
import { Icon, Pressable, useThemeColors } from '@/design';
import { MessageText } from '../message-text';

export interface ImageBubbleProps {
  uri: string;
  width?: number;
  height?: number;
  caption?: string;
  fromMe: boolean;
}

const MAX_WIDTH_RATIO = 0.62;
const MAX_HEIGHT = 320;

export function ImageBubble({ uri, width, height, caption, fromMe }: ImageBubbleProps) {
  const colors = useThemeColors();
  const { width: screenWidth } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);

  const ratio = width && height ? width / height : 4 / 3;
  const boxWidth = Math.min(screenWidth * MAX_WIDTH_RATIO, 260);
  const boxHeight = Math.min(boxWidth / ratio, MAX_HEIGHT);

  return (
    <View className="gap-1.5">
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={caption ?? 'Photo'}
        onPress={() => setZoomed(true)}
        pressScale={0.99}>
        <Image
          source={{ uri }}
          recyclingKey={uri}
          style={{ width: boxWidth, height: boxHeight, borderRadius: 14 }}
          contentFit="cover"
          transition={120}
          placeholderContentFit="cover"
        />
      </Pressable>

      {caption ? (
        <MessageText
          text={caption}
          fromMe={fromMe}
          className={fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on'}
        />
      ) : null}

      <Modal
        visible={zoomed}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomed(false)}>
        <RNPressable
          className="flex-1 items-center justify-center bg-black"
          onPress={() => setZoomed(false)}>
          <Image source={{ uri }} style={{ width: '100%', height: '80%' }} contentFit="contain" />
          <View className="absolute right-5 top-16">
            <Icon name="close" size={28} color={colors.canvas} />
          </View>
        </RNPressable>
      </Modal>
    </View>
  );
}
