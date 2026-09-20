import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, ListItem, Note, RowIcon, Sheet, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import {
  DEFAULT_EVM_PATH,
  hardwareVendors,
  type HardwareVendor,
} from '@/core/identity/hardware';
import { useIdentityStore } from '@/core/identity/identity-store';
import type { IconName } from '@/design';

const ICONS: Record<string, IconName> = {
  ledger: 'bluetooth-outline',
  keystone: 'qr-code-outline',
  trezor: 'phone-portrait-outline',
};

const HOW: Record<string, string> = {
  bluetooth: 'Unlock it and open the Ethereum app, then keep it nearby.',
  qr: 'You will scan a QR code from its screen, and it will scan one from yours.',
  'companion-app': 'Its own app opens to confirm; you come back here when it is done.',
};

export function ConnectHardware({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const addHardwareAccount = useIdentityStore((s) => s.addHardwareAccount);

  const [vendor, setVendor] = useState<HardwareVendor | null>(null);
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vendor?.scan) return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    vendor
      .scan(
        (device) =>
          setDevices((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device])),
        (e) => setError(errorMessage(e, 'Could not scan for devices'))
      )
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((e) => setError(errorMessage(e, 'Could not scan for devices')));

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [vendor]);

  const connect = useCallback(
    async (chosen: HardwareVendor, deviceId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const signer = await chosen.connect(deviceId);
        const address = await signer.getAddress(DEFAULT_EVM_PATH);
        await addHardwareAccount({ address, vendorId: chosen.id, label: chosen.label });
        toast.success(`${chosen.label} connected`);
        onClose();
      } catch (e) {
        setError(errorMessage(e, `Could not connect to your ${chosen.label}`));
      } finally {
        setBusy(false);
      }
    },
    [addHardwareAccount, onClose]
  );

  const vendors = hardwareVendors();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={vendor ? `Connect your ${vendor.label}` : 'Connect a hardware wallet'}>
      <View className="gap-3 pb-2">
        {vendor === null ? (
          <>
            <Note icon="hardware-chip-outline">
              <Text variant="footnote">
                The key stays on the device and never reaches this phone. Every transaction is
                confirmed on the wallet itself, so this app can ask but never sign.
              </Text>
            </Note>

            {vendors.map((entry) => (
              <ListItem
                key={entry.id}
                testID={`connect-${entry.id}`}
                title={entry.label}
                subtitle={HOW[entry.connection]}
                numberOfLinesSubtitle={2}
                leading={<RowIcon name={ICONS[entry.id] ?? 'hardware-chip-outline'} tone="grey" />}
                onPress={() => {
                  setError(null);
                  setDevices([]);
                  if (entry.scan) setVendor(entry);
                  else void connect(entry);
                }}
              />
            ))}
          </>
        ) : (
          <>
            <Text variant="footnote">{HOW[vendor.connection]}</Text>

            {devices.length === 0 ? (
              <Text variant="caption">Looking for nearby wallets…</Text>
            ) : (
              devices.map((device) => (
                <ListItem
                  key={device.id}
                  testID={`hardware-device-${device.id}`}
                  title={device.name || 'Unnamed wallet'}
                  leading={<RowIcon name="bluetooth-outline" tone="blue" />}
                  onPress={() => void connect(vendor, device.id)}
                />
              ))
            )}
          </>
        )}

        {error ? (
          <Text variant="footnote" className="text-danger">
            {error}
          </Text>
        ) : null}

        {busy ? <Text variant="caption">Confirm on the device…</Text> : null}

        <Button
          label={vendor ? 'Back' : 'Cancel'}
          tone="ghost"
          fullWidth
          disabled={busy}
          onPress={() => {
            setDevices([]);
            setError(null);
            if (vendor) setVendor(null);
            else onClose();
          }}
        />
      </View>
    </Sheet>
  );
}
