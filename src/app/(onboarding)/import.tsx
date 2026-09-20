import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, Enter, Field, IconButton, Screen, Text } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { isValidMnemonic, normalizeMnemonic } from '@/core/identity/keyring';
import { errorMessage } from '@/core/errors';
import { useBack } from '@/features/navigation/use-back';

export default function ImportIdentity() {
  const router = useRouter();
  const goBack = useBack('/(onboarding)/welcome');
  const adoptIdentity = useIdentityStore((s) => s.adoptIdentity);

  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wordCount = phrase.trim() ? normalizeMnemonic(phrase).split(' ').length : 0;
  const looksComplete = wordCount === 12 || wordCount === 24;

  async function submit() {
    setError(null);

    if (!isValidMnemonic(phrase)) {
      setError('That phrase is not valid. Check for typos and that the words are in order.');
      return;
    }

    setBusy(true);
    try {
      await adoptIdentity(phrase);
      router.replace('/chats');
    } catch (e) {
      setError(errorMessage(e, 'Could not restore that account'));
      setBusy(false);
    }
  }

  return (
    <Screen className="px-gutter">
      {/*
        Pushed from three places (the welcome screen, Settings › Accounts and
        the recovery route), and only the first leaves a previous screen inside
        the onboarding stack for a header back button to come from.
      */}
      <View className="-ml-2 flex-row pt-1">
        <IconButton icon="chevron-back" label="Back" onPress={goBack} />
      </View>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-between">
        <Animated.View entering={Enter.content()} className="gap-4 pt-4">
          <View className="gap-1.5">
            <Text variant="headline">Restore your account</Text>
            <Text variant="bodyMuted">
              Enter the 12 or 24 word recovery phrase. It never leaves this device.
            </Text>
          </View>

          <Field
            testID="import-phrase"
            label="Recovery phrase"
            placeholder="witch collapse practice feed shame open despair creek road again ice least"
            value={phrase}
            onChangeText={(t) => {
              setPhrase(t);
              if (error) setError(null);
            }}
            error={error ?? undefined}
            hint={wordCount > 0 ? `${wordCount} words` : 'Separate each word with a space'}
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            textAlignVertical="top"
            className="min-h-[120px]"
          />
        </Animated.View>

        <View className="gap-2 pb-8">
          <Button
            testID="import-submit"
            label="Restore account"
            size="md"
            fullWidth
            disabled={!looksComplete}
            loading={busy}
            onPress={submit}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
