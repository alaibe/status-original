import { useEffect } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { View, useWindowDimensions } from 'react-native';

import { MessageText } from '../message-text';

interface VideoBubbleProps {
  uri: string;
  width?: number;
  height?: number;
  caption?: string;
  gif?: boolean;
  fromMe: boolean;
}

export function VideoBubble({ uri, width, height, caption, gif, fromMe }: VideoBubbleProps) {
  const player = useVideoPlayer(uri, (player) => {
    player.loop = Boolean(gif);
    player.muted = Boolean(gif);
  });
  // On the desktop the <video> element only exists once the view has mounted.
  useEffect(() => {
    if (gif) player.play();
  }, [gif, player]);
  const { width: screenWidth } = useWindowDimensions();
  const boxWidth = Math.min(screenWidth * 0.62, 260);
  const boxHeight = Math.min((boxWidth * (height || 9)) / (width || 16), 320);

  return (
    <View className="gap-1.5">
      <VideoView
        player={player}
        style={{ width: boxWidth, height: boxHeight, borderRadius: 14 }}
        contentFit={gif ? 'cover' : 'contain'}
        nativeControls={!gif}
        fullscreenOptions={{ enable: !gif }}
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
