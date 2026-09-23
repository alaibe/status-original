import { requireNativeModule } from 'expo-modules-core';

export interface WebCookie {
  name: string;
  value: string;
  domain: string;
}

interface WebCookiesModule {
  /** Every cookie the app's web views hold for these hosts or their subdomains, HttpOnly included. */
  get(domains: string[]): Promise<WebCookie[]>;
  clear(domains: string[]): Promise<void>;
}

export default requireNativeModule<WebCookiesModule>('WebCookies');
