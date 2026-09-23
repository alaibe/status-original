import { useVideoPlayer, VideoView } from 'expo-video';
import { View, useWindowDimensions } from 'react-native';

import { MessageText } from '../message-text';

interface VideoBubbleProps {
  uri: string;
  width?: number;
  height?: number;
  caption?: string;
  fromMe: boolean;
}

export function VideoBubble({ uri, width, height, caption, fromMe }: VideoBubbleProps) {
  const player = useVideoPlayer(uri);
  const { width: screenWidth } = useWindowDimensions();
  const boxWidth = Math.min(screenWidth * 0.62, 260);
  const boxHeight = Math.min((boxWidth * (height || 9)) / (width || 16), 320);

  return (
    <View className="gap-1.5">
      <VideoView
        player={player}
        style={{ width: boxWidth, height: boxHeight, borderRadius: 14 }}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
      {caption ? (
        <MessageText
          text={caption}
          fromMe={fromMe}
          className={fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on'}
        />
      ) : null}
    </View>
  );
}
