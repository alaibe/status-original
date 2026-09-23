import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Text, toast } from '@/design';

/** Downloads a newer release in the background and offers to restart into it. */
export function UpdateBar() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (__DEV__) return;
    let cancelled = false;
    (async () => {
      const found = await check();
      if (!found) return;
      await found.download();
      if (!cancelled) setUpdate(found);
    })().catch((error) => console.warn('[updater]', error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const restart = async () => {
    setInstalling(true);
    try {
      await update.install();
      await relaunch();
    } catch (error) {
      console.warn('[updater]', error);
      setInstalling(false);
      toast.error('The update could not be installed');
    }
  };

  return (
    <View className="flex-row items-center gap-2 border-t border-line px-3 py-2">
      <Text variant="footnote" className="flex-1 text-content">
        Version {update.version} is ready
      </Text>
      <Button size="sm" label="Restart" loading={installing} onPress={restart} />
    </View>
  );
}
