import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { Badge, Button, Card, Field, Screen, Text, toast } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import { useChatStore } from '@/core/messaging/chat-store';
import {
  loadProtocolConfig,
  missingFields,
  withDefaults,
  type ProtocolConfig,
} from '@/core/messaging/config';
import { protocolById } from '@/protocols';
import { errorMessage } from '@/core/errors';
import { LoginStep, SignedIn } from '@/features/protocols/login';
import { describeProtocol, toneFor } from '@/features/protocols/presentation';
import { accountRuntime } from '@/runtime';
import { openExternal } from '@/lib/open-url';

export default function ProtocolConfigScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const descriptor = protocolById(id);
  const accountId = useIdentityStore((s) => s.activeAccountId);
  const connection = useChatStore((s) => (id ? s.protocols[id] : undefined));
  const session = useChatStore((s) => (id ? s.sessions[id] : undefined));

  const [config, setConfig] = useState<ProtocolConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId || !descriptor) return;
    let cancelled = false;
    loadProtocolConfig(accountId, descriptor.id).then((stored) => {
      if (!cancelled) setConfig(withDefaults(descriptor.configSchema, stored));
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, descriptor]);

  if (!descriptor) {
    return (
      <Screen className="px-0" edges={[]}>
        <Stack.Screen options={{ title: 'Protocol' }} />
        <Text className="px-gutter">No protocol called “{id}”.</Text>
      </Screen>
    );
  }

  const missing = config ? missingFields(descriptor.configSchema, config) : [];

  async function save() {
    if (!accountId || !config || !descriptor) return;

    setBusy(true);
    try {
      await accountRuntime.updateProtocolConfig(accountId, descriptor.id, config);
      toast.success(`${descriptor.label} settings saved`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save those settings'));
    }
    setBusy(false);
  }

  return (
    <Screen className="px-0" edges={[]}>
      <Stack.Screen options={{ title: descriptor.label }} />

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}>
          <View className="gap-1 px-gutter pb-3">
            <Text variant="bodyMuted">{descriptor.description}</Text>
          </View>

          <View className="gap-3 px-gutter">
            <Card className="gap-2">
              <View className="flex-row items-start gap-2">
                <Badge
                  label={descriptor.meta.properties.endToEndEncrypted ? 'Encrypted' : 'Not E2EE'}
                  tone={toneFor(descriptor.meta)}
                />
                <Text variant="caption" className="flex-1">
                  {descriptor.meta.trustModel}
                </Text>
              </View>
              <Text variant="micro">{describeProtocol(descriptor.meta)}</Text>
              {descriptor.docsUrl ? (
                <Button
                  label={`Read about ${descriptor.label}`}
                  tone="neutral"
                  size="sm"
                  onPress={() => openExternal(descriptor.docsUrl!).catch(() => {})}
                />
              ) : null}
            </Card>

            {connection?.error ? (
              <Card className="gap-1">
                <Text variant="footnote" className="font-semibold text-danger">
                  Last connection failed
                </Text>
                <Text variant="caption">{connection.error}</Text>
              </Card>
            ) : null}

            {connection?.login ? (
              <LoginStep key={connection.login.step} login={connection.login} session={session} />
            ) : session?.subscribeLogin && session.self.address ? (
              <SignedIn session={session} label={descriptor.label} />
            ) : null}

            {config === null ? (
              <Text variant="caption">Loading…</Text>
            ) : (
              descriptor.configSchema.fields.map((field) => (
                <Field
                  key={field.key}
                  testID={`protocol-field-${field.key}`}
                  label={field.label}
                  placeholder={field.placeholder}
                  hint={field.help}
                  defaultValue={config[field.key] ?? ''}
                  onChangeText={(text) =>
                    setConfig((current) => ({ ...(current ?? {}), [field.key]: text }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  secureTextEntry={field.kind === 'secret'}
                  multiline={field.kind === 'lines'}
                  numberOfLines={field.kind === 'lines' ? 5 : 1}
                  className={field.kind === 'lines' ? 'min-h-[110px]' : undefined}
                />
              ))
            )}

            {missing.length > 0 ? (
              <Text variant="caption">
                {`${descriptor.label} stays disconnected until ${missing
                  .map((f) => f.label)
                  .join(' and ')} ${missing.length === 1 ? 'is' : 'are'} filled in.`}
              </Text>
            ) : null}

            <Button
              testID="protocol-save"
              label="Save and reconnect"
              size="md"
              fullWidth
              loading={busy}
              disabled={config === null}
              onPress={save}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
