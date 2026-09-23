import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Icon,
  ListItem,
  Pressable,
  Screen,
  Text,
  useThemeColors,
} from '@/design';
import { errorMessage } from '@/core/errors';
import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatSession } from '@/core/messaging/protocol';
import { connectByChat } from '@/features/bridge-login/connect-by-chat';
import { InputStep, WaitStep } from '@/features/bridge-login/steps';
import { WebLogin } from '@/features/bridge-login/web-login';
import { useBack } from '@/features/navigation/use-back';
import { bridgeBotId, knownBridge, provisioningName } from '@/protocols/matrix/bridges';
import type {
  LoginFlow,
  LoginStep,
  MatrixCapabilities,
  Whoami,
} from '@/protocols/matrix/provisioning';

type Phase = 'loading' | 'unavailable' | 'flows' | 'step' | 'done';

export default function BridgeLoginScreen() {
  const { bridge: localpart } = useLocalSearchParams<{ bridge: string }>();
  const colors = useThemeColors();
  const goBack = useBack('/settings/protocol/matrix');
  const bridge = knownBridge(localpart ?? '');
  const session = useChatStore((s) => s.sessions.matrix) as
    | (ChatSession & Partial<MatrixCapabilities>)
    | undefined;
  const provisioning = useMemo(
    () => (bridge ? (session?.bridgeProvisioning?.(provisioningName(bridge)) ?? null) : null),
    [bridge, session]
  );

  const [phase, setPhase] = useState<Phase>('loading');
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef<LoginStep | null>(null);

  useEffect(() => {
    if (!provisioning) return;
    let cancelled = false;
    provisioning
      .whoami()
      .then((result) => {
        if (cancelled) return;
        setWhoami(result);
        setPhase('flows');
      })
      .catch(() => {
        if (!cancelled) setPhase('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [provisioning]);

  useEffect(
    () => () => {
      if (live.current && provisioning) provisioning.cancel(live.current).catch(() => {});
    },
    [provisioning]
  );

  async function advance(next: Promise<LoginStep>) {
    setBusy(true);
    setError(null);
    try {
      const result = await next;
      if (result.type === 'complete') {
        live.current = null;
        setStep(result);
        setPhase('done');
      } else {
        live.current = result;
        setStep(result);
        setPhase('step');
      }
    } catch (e) {
      setError(errorMessage(e, 'The bridge did not accept that'));
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!provisioning || step?.type !== 'display_and_wait') return;
    let cancelled = false;
    provisioning
      .wait(step)
      .then((next) => {
        if (!cancelled) advance(Promise.resolve(next));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'The sign-in stopped'));
      });
    return () => {
      cancelled = true;
    };
  }, [provisioning, step]);

  function restart() {
    if (live.current && provisioning) provisioning.cancel(live.current).catch(() => {});
    live.current = null;
    setStep(null);
    setError(null);
    setPhase('flows');
  }

  if (!bridge) {
    return (
      <Screen className="items-center justify-center">
        <Text variant="footnote">No bridge called “{localpart}”.</Text>
      </Screen>
    );
  }

  const shown: Phase = provisioning ? phase : 'unavailable';
  const flows = sortFlows(whoami?.login_flows ?? [], bridge.preferredFlow);

  return (
    <Screen className="px-gutter" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between pb-4 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={goBack}
          className="h-9 w-9 items-center justify-center rounded-pill bg-surface-sunken">
          <Icon name="close" size={20} color={colors['content-muted']} />
        </Pressable>
        <Text className="font-semibold">Connect {bridge.network}</Text>
        <View className="h-9 w-9" />
      </View>

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 pb-6">
          {shown === 'loading' ? <Text variant="caption">Asking the bridge…</Text> : null}

          {shown === 'unavailable' ? (
            <Card className="gap-3">
              <Text variant="footnote">
                This homeserver does not let the app sign in to {bridge.network} directly. You can
                still connect by chatting with the bridge’s bot.
              </Text>
              <Button
                label="Connect in a chat"
                size="md"
                fullWidth
                onPress={() => {
                  goBack();
                  connectByChat(bridge, bridgeBotId(bridge, session?.self.address ?? ''));
                }}
              />
            </Card>
          ) : null}

          {shown === 'flows' ? (
            <>
              {whoami && whoami.logins.length > 0 ? (
                <Card className="gap-1">
                  <Text variant="footnote" className="font-semibold">
                    Signed in as {whoami.logins.map((login) => login.name || login.id).join(', ')}
                  </Text>
                  <Text variant="caption">Sign in again to add another account.</Text>
                </Card>
              ) : null}
              <Text variant="footnote">How do you want to sign in to {bridge.network}?</Text>
              <View className="gap-2">
                {flows.map((flow) => (
                  <Card key={flow.id} className="p-0">
                    <ListItem
                      testID={`bridge-flow-${flow.id}`}
                      title={flow.name}
                      subtitle={flow.description}
                      numberOfLinesSubtitle={2}
                      meta={
                        flow.id === bridge.preferredFlow ? (
                          <Badge label="Recommended" tone="brand" />
                        ) : undefined
                      }
                      onPress={() => provisioning && advance(provisioning.start(flow.id))}
                    />
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          {shown === 'step' && step ? (
            <View className="gap-4">
              {step.instructions && step.type !== 'cookies' ? (
                <Text variant="footnote">{step.instructions}</Text>
              ) : null}
              {step.type === 'user_input' ? (
                <InputStep
                  key={`${step.login_id}/${step.step_id}`}
                  step={step}
                  busy={busy}
                  onSubmit={(values) => provisioning && advance(provisioning.submit(step, values))}
                />
              ) : step.type === 'display_and_wait' ? (
                <WaitStep step={step} />
              ) : step.type === 'cookies' && step.cookies ? (
                <WebLogin
                  key={`${step.login_id}/${step.step_id}`}
                  params={step.cookies}
                  network={bridge.network}
                  onValues={(values) => provisioning && advance(provisioning.submit(step, values))}
                  onCancel={restart}
                />
              ) : (
                <Card className="gap-3">
                  <Text variant="footnote">
                    This way of signing in needs something the app cannot do yet. Pick another one,
                    or connect in a chat with the bridge’s bot.
                  </Text>
                  <Button label="Choose another way" tone="neutral" onPress={restart} />
                </Card>
              )}
              {step.type !== 'cookies' ? (
                <Button label="Start over" tone="ghost" size="sm" onPress={restart} />
              ) : null}
            </View>
          ) : null}

          {shown === 'done' ? (
            <Card className="gap-3">
              <Text className="font-semibold">{bridge.network} is connected</Text>
              <Text variant="footnote">
                Your conversations appear in the chat list as the bridge catches up. Older history
                can take a few minutes.
              </Text>
              <Button label="Done" size="md" fullWidth onPress={goBack} />
            </Card>
          ) : null}

          {error ? (
            <Card className="gap-1">
              <Text variant="footnote" className="font-semibold text-danger">
                That did not work
              </Text>
              <Text variant="caption">{error}</Text>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function sortFlows(flows: LoginFlow[], preferred: string | undefined): LoginFlow[] {
  return [...flows].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}
