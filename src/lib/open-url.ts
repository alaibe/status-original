import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/** A web page, shown in the in-app browser; full screen for a site you work in rather than read. */
export function openInBrowser(url: string, options?: { fullScreen?: boolean }): Promise<unknown> {
  return WebBrowser.openBrowserAsync(url, {
    presentationStyle: options?.fullScreen
      ? WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN
      : undefined,
  });
}

/** Anything the system knows how to open: another app's scheme, a store page. */
export async function openExternal(url: string): Promise<void> {
  await Linking.openURL(url);
}

export function canOpenExternal(url: string): Promise<boolean> {
  return Linking.canOpenURL(url);
}
