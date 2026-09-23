import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Button, Card, Text } from '@/design';
import {
  extractionScript,
  localStorageKeys,
  readbackScript,
  readyWebFields,
  webDomains,
  type WebSnapshot,
} from '@/protocols/matrix/provisioning';

import WebCookies from '../../../modules/web-cookies';
import { parsePage, type PageState, type WebLoginProps } from './web-page';

/** iOS Safari carries the iOS version; sites refuse a web view that does not say Safari. */
const SAFARI =
  Platform.OS === 'ios'
    ? `Version/${String(Platform.Version).split('.')[0]}.0 Mobile/15E148 Safari/604.1`
    : undefined;

export function WebLogin({ params, network, onValues, onCancel }: WebLoginProps) {
  const [open, setOpen] = useState(true);
  const page = useRef<PageState | null>(null);
  const url = useRef(params.url);
  const domains = useMemo(() => webDomains(params), [params]);
  const injected = useMemo(
    () =>
      `${extractionScript(params)}
setInterval(() => window.ReactNativeWebView.postMessage(${readbackScript(localStorageKeys(params))}), 1000);
true;`,
    [params]
  );

  async function finish(values: Record<string, string> | null) {
    setOpen(false);
    await WebCookies.clear(domains).catch(() => {});
    if (values) onValues(values);
    else onCancel();
  }
  const done = useEffectEvent(finish);

  useEffect(() => {
    let stopped = false;
    WebCookies.clear(domains).catch(() => {});
    const timer = setInterval(async () => {
      const cookies = await WebCookies.get(domains).catch(() => []);
      if (stopped) return;
      const snapshot: WebSnapshot = {
        url: url.current,
        cookies,
        extracted: page.current?.extracted ?? null,
        localStorage: page.current?.localStorage ?? {},
      };
      const values = readyWebFields(params, snapshot);
      if (values) {
        stopped = true;
        clearInterval(timer);
        done(values);
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [params, domains]);

  return (
    <>
      <Card className="gap-2" testID="bridge-web-login">
        <Text variant="footnote">
          Sign in to {network} on the page that opened. It closes by itself once the bridge has what
          it needs.
        </Text>
      </Card>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => finish(null)}>
        <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
          <View className="flex-row items-center justify-between px-gutter py-2">
            <Text className="font-semibold">Sign in to {network}</Text>
            <Button label="Cancel" tone="ghost" size="sm" onPress={() => finish(null)} />
          </View>
          <WebView
            source={{ uri: params.url }}
            userAgent={params.user_agent || undefined}
            applicationNameForUserAgent={SAFARI}
            injectedJavaScript={injected}
            onMessage={(event) => {
              page.current = parsePage(event.nativeEvent.data) ?? page.current;
            }}
            onNavigationStateChange={(state) => {
              url.current = state.url;
            }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
