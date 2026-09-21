import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Icon, Pressable, Text, useThemeColors } from '@/design';
import { formatDuration } from '@/core/messaging/preview';
import type { MessageContent } from '@/core/messaging/types';

export interface VoiceRecorderProps {
  onRecorded(content: MessageContent): void;
  onError(message: string): void;
}

export function VoiceRecorder({ onRecorded, onError }: VoiceRecorderProps) {
  const colors = useThemeColors();
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const state = useAudioRecorderState(recorder, 250);

  const [starting, setStarting] = useState(false);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError('Microphone access is off for this app.');
      } else {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
    } catch {
      onError('Could not start recording.');
    }
    setStarting(false);
  }, [recorder, onError]);

  const finish = useCallback(
    async (keep: boolean) => {
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        onError('Could not save that recording.');
        return;
      }

      const uri = recorder.uri;
      if (!keep || !uri) return;

      const durationMs = Math.round(state.durationMillis ?? 0);
      if (durationMs < 500) {
        onError('Too short. Hold on a moment longer.');
        return;
      }

      onRecorded({ kind: 'voice', uri, durationMs, name: 'voice.m4a', mimeType: 'audio/m4a' });
    },
    [recorder, state.durationMillis, onRecorded, onError]
  );

  if (!state.isRecording) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record a voice message"
        disabled={starting}
        onPress={start}
        className="h-11 w-11 items-center justify-center rounded-pill border border-line bg-surface-raised">
        <Icon name="mic-outline" size={20} color={colors['content-muted']} />
      </Pressable>
    );
  }

  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Discard recording"
        onPress={() => finish(false)}
        className="h-11 w-11 items-center justify-center rounded-pill border border-line bg-surface-raised">
        <Icon name="trash-outline" size={18} color={colors.danger} />
      </Pressable>

      <View className="flex-row items-center gap-1.5 rounded-pill bg-danger/15 px-3 py-2">
        <View className="h-2 w-2 rounded-full bg-danger" />
        <Text variant="caption" className="font-medium tabular-nums text-content">
          {formatDuration(state.durationMillis ?? 0)}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        onPress={() => finish(true)}
        className="h-11 w-11 items-center justify-center rounded-pill bg-brand">
        <Icon name="arrow-up" size={20} color={colors['brand-on']} />
      </Pressable>
    </View>
  );
}
