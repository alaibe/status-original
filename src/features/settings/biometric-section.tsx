import { useEffect, useState } from 'react';
import { Switch } from 'react-native';

import { ConfirmSheet, ListItem, RowIcon, Section, toast } from '@/design';
import { useIdentityStore } from '@/core/identity/identity-store';
import {
  disableKeyProtection,
  enableKeyProtection,
  isKeyProtectionEnabled,
} from '@/core/identity/key-protection';
import { biometricCapability, isLockEnabled, setLockEnabled } from '@/core/identity/lock';
import { useLockStore } from '@/core/identity/lock-store';

export function BiometricSection() {
  const noteJustAuthenticated = useLockStore((s) => s.noteJustAuthenticated);
  const accounts = useIdentityStore((st) => st.accounts);

  const [label, setLabel] = useState('Biometrics');
  const [enrolled, setEnrolled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [protectedKeys, setProtectedKeys] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const capability = await biometricCapability();
      setLabel(capability.label);
      setAvailable(capability.available);
      setEnrolled(capability.enrolled);
      setEnabled(await isLockEnabled());
      setProtectedKeys(await isKeyProtectionEnabled());
    })();
  }, []);

  if (!available) return null;

  const ids = accounts.map((a) => a.id);

  async function applyProtection(next: boolean) {
    setBusy(true);
    try {
      const result = next
        ? await enableKeyProtection(ids)
        : await disableKeyProtection(ids);

      if (result.ok) {
        setProtectedKeys(next);
        noteJustAuthenticated();
        return;
      }
      toast.error(
        result.reason === 'denied'
          ? `${label} was not confirmed, so nothing changed`
          : 'Your recovery phrase could not be read, so nothing changed'
      );
    } catch {
      toast.error('Could not change key protection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Security" surface="card" className="mb-6">
        <ListItem
          title={`Require ${label}`}
          subtitle={
            enrolled
              ? 'Asks before showing your accounts, and again after a minute in the background'
              : `Set up ${label} on this device first`
          }
          numberOfLinesSubtitle={2}
          leading={<RowIcon name="finger-print-outline" tone="green" />}
          trailing={
            <Switch
              value={enabled}
              disabled={!enrolled || busy}
              onValueChange={async (next) => {
                setBusy(true);
                try {
                  if (!next && protectedKeys) {
                    const unsealed = await disableKeyProtection(ids);
                    if (!unsealed.ok) {
                      toast.error(
                        unsealed.reason === 'denied'
                          ? `${label} was not confirmed, so nothing changed`
                          : 'Your recovery phrase could not be read, so nothing changed'
                      );
                      return;
                    }
                    setProtectedKeys(false);
                  }

                  const applied = await setLockEnabled(next, label);
                  if (!applied) return;

                  setEnabled(next);
                  noteJustAuthenticated();
                } catch {
                  toast.error('Could not change the lock setting');
                } finally {
                  setBusy(false);
                }
              }}
            />
          }
        />

        {enabled ? (
          <ListItem
            title="Also protect keys"
            subtitle={`Your recovery phrase is sealed in the keychain and cannot be read without ${label}`}
            numberOfLinesSubtitle={2}
            leading={<RowIcon name="lock-closed-outline" tone="red" />}
            trailing={
              <Switch
                value={protectedKeys}
                disabled={busy}
                onValueChange={(next) => {
                  if (next) setConfirming(true);
                  else applyProtection(false);
                }}
              />
            }
          />
        ) : null}
      </Section>

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Write down your phrase first"
        body={[
          `With this on, ${label} is required to read your recovery phrase as well as to open the app. Nothing running on this device can get at your keys without you.`,
          `The catch: iOS discards these keys whenever the ${label} on this device changes. Adding a face or fingerprint is enough. Your messages and settings survive, but you will have to import each account's recovery phrase again. If it is not written down, that account is gone for good.`,
        ]}
        busy={busy}
        confirm={{
          label: 'My phrase is written down. Turn it on',
          onPress: async () => {
            setConfirming(false);
            await applyProtection(true);
          },
        }}
      />
    </>
  );
}

