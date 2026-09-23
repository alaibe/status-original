import { Image } from 'expo-image';

import { View } from 'react-native';

import { cn } from '../lib/cn';
import { Text } from './text';

const SIZE = { sm: 32, md: 44, lg: 64, xl: 96 } as const;

function hash(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function identicon(seed: string) {
  const h = hash(seed);
  const hue = h % 360;
  const bg = `hsl(${hue} 68% 52%)`;
  const fg = `hsl(${(hue + 42) % 360} 74% 74%)`;

  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    const left: boolean[] = [];
    for (let col = 0; col < 3; col++) {
      left.push(((h >>> ((row * 3 + col) % 29)) & 1) === 1);
    }
    cells.push(...left, left[1], left[0]);
  }
  return { bg, fg, cells };
}

export interface AvatarProps {
  seed: string;
  size?: keyof typeof SIZE;
  label?: string;
  /** A bundled image or a picture's URI; shown instead of initials or the identicon. */
  image?: number | string;
  emoji?: string;
  className?: string;
}

export function Avatar({ seed, size = 'md', label, image, emoji, className }: AvatarProps) {
  const px = SIZE[size];
  const { bg, fg, cells } = identicon(seed || 'anon');

  // expo-image has no NativeWind interop here, so the circle is plain style.
  if (image !== undefined) {
    return (
      <Image
        accessibilityRole="image"
        accessibilityLabel={label ? `Avatar for ${label}` : 'Avatar'}
        source={typeof image === 'string' ? { uri: image } : image}
        contentFit="cover"
        style={{ width: px, height: px, borderRadius: px / 2 }}
      />
    );
  }

  if (emoji) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={label ? `Avatar for ${label}` : 'Avatar'}
        style={{ width: px, height: px }}
        className={cn('items-center justify-center rounded-pill bg-brand-soft', className)}>
        <Text style={{ fontSize: px * 0.52, lineHeight: px, textAlign: 'center' }}>{emoji}</Text>
      </View>
    );
  }

  if (label) {
    const initials = label.trim().slice(0, 2).toUpperCase();
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={`Avatar for ${label}`}
        style={{ width: px, height: px, backgroundColor: bg }}
        className={cn('items-center justify-center rounded-pill', className)}>
        <Text className="font-semibold text-white" style={{ fontSize: px * 0.36 }}>
          {initials}
        </Text>
      </View>
    );
  }

  const cell = px / 5;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Identicon"
      style={{ width: px, height: px, backgroundColor: bg }}
      className={cn('flex-row flex-wrap overflow-hidden rounded-pill', className)}>
      {cells.map((on, i) => (
        <View
          key={i}
          style={{ width: cell, height: cell, backgroundColor: on ? fg : 'transparent' }}
        />
      ))}
    </View>
  );
}
