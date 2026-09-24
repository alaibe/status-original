export type XmtpEnvironment = 'dev' | 'local' | 'production';

export function xmtpEnvironment(): XmtpEnvironment {
  const configured = process.env.EXPO_PUBLIC_XMTP_ENV;
  return configured === 'dev' || configured === 'local' || configured === 'production'
    ? configured
    : 'production';
}

export function fallbackFilename(uri: string, kind: 'image' | 'voice'): string {
  const fromUri = uri.split('/').pop()?.split('?')[0];
  if (fromUri && fromUri.includes('.')) return fromUri;
  return kind === 'image' ? 'photo.jpg' : 'voice.m4a';
}
