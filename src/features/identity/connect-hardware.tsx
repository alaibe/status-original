import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, ListItem, Note, RowIcon, Sheet, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import {
  DEFAULT_EVM_PATH,
  hardwareVendors,
  type HardwareConnection,
  type HardwareVendor,
} from '@/core/identity/hardware';
import { useIdentityStore } from '@/core/identity/identity-store';
import type { IconName } from '@/design';

const CONNECTION: Record<HardwareConnection, { icon: IconName; searching: string; how: string }> = {
  bluetooth: {
    icon: 'bluetooth-outline',
    searching: 'Looking for nearby wallets…',
    how: 'Unlock it and open the Ethereum app, then keep it nearby.',
  },
  usb: {
    icon: 'hardware-chip-outline',
    searching: 'Looking for a plugged-in wallet…',
    how: 'Plug it in, unlock it and open the Ethereum app.',
  },
  qr: {
    icon: 'qr-code-outline',
    searching: '',
    how: 'You will scan a QR code from its screen, and it will scan one from yours.',
  },
  'companion-app': {
    icon: 'phone-portrait-outline',
    searching: '',
    how: 'Its own app opens to confirm; you come back here when it is done.',
  },
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

  const connect = async (chosen: HardwareVendor, deviceId?: string) => {
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
    }
    setBusy(false);
  };

  const vendors = hardwareVendors();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={vendor ? `Connect your ${vendor.label}` : 'Connect a hardware wallet'}>
      <View className="gap-3">
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
                subtitle={CONNECTION[entry.connection].how}
                numberOfLinesSubtitle={2}
                leading={<RowIcon name={CONNECTION[entry.connection].icon} tone="grey" />}
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
            <Text variant="footnote">{CONNECTION[vendor.connection].how}</Text>

            {devices.length === 0 ? (
              <Text variant="caption">{CONNECTION[vendor.connection].searching}</Text>
            ) : (
              devices.map((device) => (
                <ListItem
                  key={device.id}
                  testID={`hardware-device-${device.id}`}
                  title={device.name || 'Unnamed wallet'}
                  leading={<RowIcon name={CONNECTION[vendor.connection].icon} tone="blue" />}
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

        {vendor ? (
          <Button
            label="Back"
            tone="neutral"
            fullWidth
            disabled={busy}
            onPress={() => {
              setDevices([]);
              setError(null);
              setVendor(null);
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}
