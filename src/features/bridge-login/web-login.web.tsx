import { invoke } from '@tauri-apps/api/core';
import { useEffect, useEffectEvent } from 'react';
import { View } from 'react-native';

import { Button, Card, Text, toast } from '@/design';
import { errorMessage } from '@/core/errors';
import {
  extractionScript,
  localStorageKeys,
  readbackScript,
  readyWebFields,
  type WebCookie,
  type WebSnapshot,
} from '@/protocols/matrix/provisioning';

import { parsePage, type WebLoginProps } from './web-page';

interface WindowSnapshot {
  open: boolean;
  url: string;
  cookies: WebCookie[];
  page: string | null;
}

export function WebLogin({ params, network, onValues, onCancel }: WebLoginProps) {
  const done = useEffectEvent((values: Record<string, string> | null) =>
    values ? onValues(values) : onCancel()
  );

  useEffect(() => {
    let stopped = false;
    let last: WebSnapshot | null = null;
    const readback = readbackScript(localStorageKeys(params));

    async function finish(values: Record<string, string> | null) {
      stopped = true;
      await invoke('web_login_close').catch(() => {});
      done(values);
    }

    async function run() {
      try {
        await invoke('web_login_open', {
          url: params.url,
          title: `Sign in to ${network}`,
          userAgent: params.user_agent ?? null,
          script: extractionScript(params),
          hidden: params.hidden ?? false,
        });
      } catch (e) {
        toast.error(errorMessage(e, 'Could not open the sign-in window'));
        await finish(null);
        return;
      }
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (stopped) return;
        const seen = await invoke<WindowSnapshot>('web_login_poll', { readback }).catch(() => null);
        if (!seen || stopped) continue;
        if (!seen.open) {
          await finish(last ? readyWebFields(params, last, true) : null);
          return;
        }
        const page = parsePage(seen.page);
        last = {
          url: seen.url,
          cookies: seen.cookies,
          extracted: page?.extracted ?? null,
          localStorage: page?.localStorage ?? {},
        };
        const values = readyWebFields(params, last);
        if (values) {
          await finish(values);
          return;
        }
      }
    }

    run();
    return () => {
      stopped = true;
      invoke('web_login_close').catch(() => {});
    };
  }, [params, network]);

  return (
    <Card className="gap-3" testID="bridge-web-login">
      <Text variant="footnote">
        Sign in to {network} in the window that opened. It closes by itself once the bridge has what
        it needs; the app reads only that, and the window keeps nothing afterwards.
      </Text>
      <View className="flex-row gap-2">
        <Button
          label="Cancel"
          tone="neutral"
          size="sm"
          onPress={() => {
            invoke('web_login_close').catch(() => {});
            onCancel();
          }}
        />
      </View>
    </Card>
  );
}
