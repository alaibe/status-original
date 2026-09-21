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

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  heic: 'image/heic',
  webp: 'image/webp',
  m4a: 'audio/m4a',
  pdf: 'application/pdf',
};

export function fallbackMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
