import { Image } from 'expo-image';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { cn, Icon, Pressable, Text } from '@/design';
import { useAppearanceStore } from '@/core/app/appearance';
import type { LinkPreview } from '@/core/messaging/link-preview';
import { openExternal, openInBrowser } from '@/lib/open-url';
import { useLinkPreview } from './use-link-preview';

// A fixed width: a short message then grows to fit the card, instead of the
// picture spilling out of a bubble sized to the text.
const MAX_WIDTH_RATIO = 0.7;
const MAX_WIDTH = 300;
const MAX_IMAGE_HEIGHT = 220;
const DEFAULT_RATIO = 1.91;

export function LinkPreviewCard({ url, fromMe }: { url: string; fromMe: boolean }) {
  const enabled = useAppearanceStore((s) => s.linkPreviews);
  const preview = useLinkPreview(enabled ? url : null);
  const { width: screenWidth } = useWindowDimensions();

  if (!preview) return null;

  const { siteName, title, description, image, video } = preview;
  // A video link goes to the system so an installed player app can claim it.
  const open = () => {
    (video ? openExternal(preview.url) : openInBrowser(preview.url)).catch(() => {});
  };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[siteName, title].filter(Boolean).join('. ') || url}
      onPress={open}
      className={cn(
        'mt-1.5 flex-row gap-2 rounded-md px-2 py-1.5',
        fromMe ? 'bg-bubble-out-on/15' : 'bg-content/5'
      )}
      style={{ borderCurve: 'continuous', width: Math.min(screenWidth * MAX_WIDTH_RATIO, MAX_WIDTH) }}>
      <View className={cn('w-0.5 rounded-full', fromMe ? 'bg-bubble-out-on' : 'bg-brand')} />
      <View className="min-w-0 flex-1 gap-0.5">
        {siteName ? (
          <Text
            variant="caption"
            numberOfLines={1}
            className={cn('font-semibold', fromMe ? 'text-bubble-out-on' : 'text-brand')}>
            {siteName}
          </Text>
        ) : null}
        {title ? (
          <Text
            variant="footnote"
            numberOfLines={3}
            className={cn('font-semibold', fromMe ? 'text-bubble-out-on' : 'text-bubble-in-on')}>
            {title}
          </Text>
        ) : null}
        {description ? (
          <Text
            variant="footnote"
            numberOfLines={3}
            className={fromMe ? 'text-bubble-out-on/80' : undefined}>
            {description}
          </Text>
        ) : null}
        {image ? <PreviewImage key={image.url} image={image} video={video} /> : null}
      </View>
    </Pressable>
  );
}

function PreviewImage({
  image,
  video,
}: {
  image: NonNullable<LinkPreview['image']>;
  video?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);

  // Declared dimensions win over the file's own: a poster frame is cropped to
  // the shape the site declared, which removes letterbox bars.
  const declared = image.width && image.height ? image.width / image.height : null;
  const ratio = declared ?? (loaded ? loaded.width / loaded.height : DEFAULT_RATIO);

  return (
    <View className="mt-1 overflow-hidden rounded-[10px]">
      <Image
        source={{ uri: image.url }}
        accessibilityIgnoresInvertColors
        style={{ width: '100%', aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }}
        contentFit="cover"
        transition={120}
        onLoad={({ source }) => setLoaded({ width: source.width, height: source.height })}
      />
      {video ? (
        <View className="absolute inset-0 items-center justify-center">
          <View className="h-12 w-12 items-center justify-center rounded-pill bg-black/55 pl-1">
            <Icon name="play" size={22} color="white" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
