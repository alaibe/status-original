import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button, IconButton, Screen, Text } from '@/design';
import type { PluginContext } from '@/core/plugins/types';
import { errorMessage } from '@/core/errors';

import { useWalletConnectStore } from '../walletconnect';

/**
 * Scanning the QR a site shows. The camera is only open while this is on
 * screen, and a `wc:` URI is the only thing acted on. Anything else scanned
 * is ignored, because a QR code is an untrusted string a stranger controls.
 */
export function makeScanOverlay(context: PluginContext) {
  return function ScanOverlay() {
    const scanning = useWalletConnectStore((s) => s.scanning);
    const setScanning = useWalletConnectStore((s) => s.setScanning);
    if (!scanning) return null;
    return (
      <Modal visible animationType="slide" onRequestClose={() => setScanning(false)}>
        <SafeAreaProvider>
          <Scanner context={context} onClose={() => setScanning(false)} />
        </SafeAreaProvider>
      </Modal>
    );
  };
}

function Scanner({ context, onClose }: { context: PluginContext; onClose(): void }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void getPermission().catch((error) => {
          setError(errorMessage(error, 'Could not check camera permission'));
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  const allowCamera = async () => {
    const cannotAsk = permission?.canAskAgain === false;
    try {
      if (cannotAsk) await Linking.openSettings();
      else await requestPermission();
    } catch (error) {
      setError(errorMessage(error, 'Could not request camera access'));
    }
  };

  const onScanned = async ({ data }: { data: string }) => {
    // One pairing per visit. The scanner fires per frame, so without this a
    // code in view for half a second pairs a dozen times.
    if (pairing) return;
    if (!data.startsWith('wc:')) {
      setError('That is a QR code, but not a WalletConnect one.');
      return;
    }

    setPairing(true);
    try {
      const store = useWalletConnectStore.getState();
      if (!store.kit) await store.init(context);
      await store.pair(data);
      context.ui.notify('Pairing… approve the request when it appears.');
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Could not pair with that code'));
      setPairing(false);
    }
  };

  return (
    <Screen className="px-0" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-gutter pb-2">
        <IconButton icon="close" label="Stop scanning" onPress={onClose} />
        <Text className="font-semibold">Scan to connect</Text>
        <View className="size-tap" />
      </View>

      {permission?.granted ? (
        <View className="flex-1 overflow-hidden">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={pairing ? undefined : onScanned}
            onMountError={({ message }) => setError(message)}
          />
        </View>
      ) : (
        <View className="flex-1 justify-center gap-4 px-gutter">
          <Text variant="bodyMuted">
            Point the camera at the WalletConnect code a site shows you. It is used for that
            and nothing else, and no image leaves this device.
          </Text>
          <Button
            label={permission?.canAskAgain === false ? 'Open Settings' : 'Allow the camera'}
            fullWidth
            onPress={allowCamera}
          />
        </View>
      )}

      <View className="gap-2 px-gutter pt-3">
        {error ? (
          <Text variant="caption" className="text-danger">
            {error}
          </Text>
        ) : (
          <Text variant="caption">
            Choose WalletConnect on the site, then scan the code it shows.
          </Text>
        )}
      </View>
    </Screen>
  );
}
