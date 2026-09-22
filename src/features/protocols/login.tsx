import { useState } from 'react';

import { Button, Card, Field, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import type { ChatSession, LoginState } from '@/core/messaging/protocol';

const COPY: Record<LoginState['step'], { label: string; placeholder: string; action: string }> = {
  phone: { label: 'Phone number', placeholder: '+44 7700 900123', action: 'Send code' },
  code: { label: 'Code', placeholder: '12345', action: 'Continue' },
  password: { label: 'Password', placeholder: 'Your password', action: 'Sign in' },
};

/**
 * One step of an interactive sign-in, driven by whatever the session is
 * waiting on. Key it by step so the field starts empty at each one.
 */
export function LoginStep({
  login,
  session,
  label,
}: {
  login: LoginState;
  session: ChatSession | undefined;
  label: string;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = COPY[login.step];

  async function submit() {
    if (!session?.submitLogin || value.trim().length === 0) return;
    setBusy(true);
    try {
      await session.submitLogin(value);
    } catch (e) {
      toast.error(errorMessage(e, `${label} did not accept that`));
    }
    setBusy(false);
  }

  return (
    <Card className="gap-3" testID="protocol-login">
      <Text variant="footnote" className="font-semibold">
        {login.title ?? `Sign in to ${label}`}
      </Text>
      <Field
        testID={`protocol-login-${login.step}`}
        label={copy.label}
        placeholder={copy.placeholder}
        hint={login.hint}
        error={login.error}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        keyboardType={login.step === 'password' ? 'default' : login.step === 'phone' ? 'phone-pad' : 'number-pad'}
        secureTextEntry={login.step === 'password'}
        autoComplete={login.step === 'phone' ? 'tel' : login.step === 'code' ? 'one-time-code' : 'password'}
        textContentType={
          login.step === 'phone' ? 'telephoneNumber' : login.step === 'code' ? 'oneTimeCode' : 'password'
        }
      />
      <Button
        testID="protocol-login-submit"
        label={copy.action}
        size="md"
        fullWidth
        loading={busy}
        disabled={value.trim().length === 0}
        onPress={submit}
      />
    </Card>
  );
}

export function SignedIn({ session, label }: { session: ChatSession; label: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (!session.signOut) return;
    setBusy(true);
    try {
      await session.signOut();
      toast.success(`Signed out of ${label}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not sign out'));
    }
    setBusy(false);
  }

  return (
    <Card className="gap-2" testID="protocol-signed-in">
      <Text variant="footnote" className="font-semibold">
        Signed in as {session.self.address}
      </Text>
      <Text variant="caption">
        Signing out ends this session on {label} as well and removes its data from this device.
      </Text>
      {session.signOut ? (
        <Button label="Sign out" tone="neutral" size="sm" loading={busy} onPress={signOut} />
      ) : null}
    </Card>
  );
}
