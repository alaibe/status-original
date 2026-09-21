import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Field, Pressable, Sheet, Text } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import type { MessageContent } from '@/core/messaging/types';
import { errorMessage } from '@/core/errors';
import { gifToContent, loadGifKey, searchGifs, type Gif } from './gifs';

export interface GifPickerProps {
  visible: boolean;
  onClose(): void;
  onPick(content: MessageContent): void;
}

export function GifPicker({ visible, onClose, onPick }: GifPickerProps) {
  const accountId = useIdentityStore((s) => s.activeAccountId);

  const [key, setKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Gif[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !accountId) return;
    loadGifKey(accountId).then(setKey).catch(() => setKey(null));
  }, [visible, accountId]);

  const run = async () => {
    if (!key || query.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchGifs(key, query.trim()));
    } catch (e) {
      setError(errorMessage(e, 'Could not search GIFs'));
    }
    setBusy(false);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="GIFs">
      {key === null ? (
        <View className="gap-3">
          <Text variant="footnote">
            GIF search needs a KLIPY key, which you add in Settings. There is no keyless GIF API,
            and this app does not ship credentials of its own.
          </Text>
          <Text variant="footnote">
            You can still send GIFs without one: pick them from your photo library like any other
            image and they send animated.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          <Field
            onChangeText={setQuery}
            placeholder="Search GIFs"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={run}
          />

          {error ? (
            <Text variant="caption" className="text-danger">
              {error}
            </Text>
          ) : null}

          {busy ? (
            <View className="py-8">
              <ActivityIndicator />
            </View>
          ) : (
            <ScrollView className="max-h-80">
              <View className="flex-row flex-wrap gap-1">
                {results.map((gif) => (
                  <Pressable
                    key={gif.id}
                    accessibilityRole="button"
                    accessibilityLabel={gif.description}
                    onPress={async () => {
                      try {
                        if (!accountId) return;
                        onPick(await gifToContent(accountId, gif));
                        onClose();
                      } catch (e) {
                        setError(errorMessage(e, 'Could not send that GIF'));
                      }
                    }}>
                    <Image
                      source={{ uri: gif.previewUrl }}
                      style={{ width: 104, height: 104, borderRadius: 10 }}
                      contentFit="cover"
                    />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          <Text variant="micro" className="text-right">
            GIFs by KLIPY
          </Text>
        </View>
      )}
    </Sheet>
  );
}
