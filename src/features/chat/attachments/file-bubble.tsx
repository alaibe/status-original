import { View } from 'react-native';

import { formatBytes } from './format';
import { Icon, type IconName, Pressable, Text, useThemeColors } from '@/design';
import { openInBrowser } from '@/lib/open-url';

export interface FileBubbleProps {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  fromMe: boolean;
}

function iconFor(name: string, mimeType?: string): IconName {
  const type = mimeType ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (type.startsWith('video/')) return 'videocam-outline';
  if (type.startsWith('audio/')) return 'musical-notes-outline';
  if (type === 'application/pdf' || ext === 'pdf') return 'document-text-outline';
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'file-tray-full-outline';
  return 'document-outline';
}

export function FileBubble({ uri, name, mimeType, size, fromMe }: FileBubbleProps) {
  const colors = useThemeColors();
  const tint = fromMe ? colors['bubble-out-on'] : colors.brand;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      onPress={() => {
        openInBrowser(uri).catch(() => {});
      }}
      pressScale={0.99}>
      <View className="min-w-[180px] flex-row items-center gap-3 py-0.5">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-sunken">
          <Icon name={iconFor(name, mimeType)} size={20} color={tint} />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className={fromMe ? 'font-medium text-bubble-out-on' : 'font-medium text-bubble-in-on'}>
            {name}
          </Text>
          {size !== undefined ? (
            <Text variant="caption" className={fromMe ? 'text-bubble-out-on/70' : undefined}>
              {formatBytes(size)}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
