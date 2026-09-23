import { requireNativeModule } from 'expo-modules-core';

export interface WebCookie {
  name: string;
  value: string;
  domain: string;
}

interface WebCookiesModule {
  get(domains: string[]): Promise<WebCookie[]>;
  clear(domains: string[]): Promise<void>;
}

export default requireNativeModule<WebCookiesModule>('WebCookies');
