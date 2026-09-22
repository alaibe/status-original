import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, type TextInput, View } from 'react-native';

import { Button, Field, Note, Screen, Section, Text, toast } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { errorMessage } from '@/core/errors';
import { openExternal } from '@/lib/open-url';

export interface ApiKeyScreenProps {
  title: string;
  sectionTitle: string;
  testIdPrefix: string;
  placeholder: string;
  load(accountId: string): Promise<string | null>;
  save(accountId: string, key: string): Promise<void>;
  /** Toasted after a non-empty key is saved. */
  savedMessage: string;
  notes: string[];
  link: { label: string; url: string };
}

export function ApiKeyScreen({
  title,
  sectionTitle,
  testIdPrefix,
  placeholder,
  load,
  save,
  savedMessage,
  notes,
  link,
}: ApiKeyScreenProps) {
  const accountId = useIdentityStore((s) => s.activeAccountId);
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<string | null>();
  const inputRef = useRef<TextInput>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    load(accountId)
      .then((existing) => {
        setSaved(existing);
        setKey(existing ?? '');
      })
      .catch(() => setSaved(null));
  }, [accountId, load]);

  async function submit(value: string) {
    if (!accountId) {
      toast.error('No account is active yet.');
      return;
    }
    const next = value.trim() === '' ? null : value.trim();
    const done = next ? savedMessage : 'Key removed';
    setBusy(true);
    try {
      await save(accountId, value);
      setSaved(next);
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save that key'));
    }
    setBusy(false);
  }

  return (
    <Screen className="bg-surface px-0" edges={[]}>
      <Stack.Screen options={{ title }} />

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled">
        {saved === undefined ? null : (
          <Section title={sectionTitle} surface="card" className="mb-6">
            <View className="gap-3 px-gutter py-4">
              <Field
                ref={inputRef}
                testID={testIdPrefix}
                defaultValue={saved ?? ''}
                onChangeText={setKey}
                placeholder={placeholder}
                autoCorrect={false}
                autoCapitalize="none"
                hint={saved ? 'A key is saved for this account.' : 'No key yet.'}
              />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    testID={`${testIdPrefix}-save`}
                    label="Save"
                    fullWidth
                    loading={busy}
                    disabled={busy || key.trim() === (saved ?? '')}
                    onPress={() => submit(key)}
                  />
                </View>
                {saved ? (
                  <View className="flex-1">
                    <Button
                      testID={`${testIdPrefix}-clear`}
                      label="Remove"
                      tone="neutral"
                      fullWidth
                      disabled={busy}
                      onPress={() => {
                        inputRef.current?.clear();
                        setKey('');
                        submit('');
                      }}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </Section>
        )}

        <Note className="mx-gutter" icon="information-circle-outline">
          {notes.map((note) => (
            <Text key={note} variant="footnote">
              {note}
            </Text>
          ))}
          <Button
            label={link.label}
            tone="neutral"
            onPress={() => openExternal(link.url).catch(() => {})}
          />
        </Note>
      </ScrollView>
    </Screen>
  );
}
