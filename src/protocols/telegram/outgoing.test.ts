import { inputContent } from './outgoing';

jest.mock('@/storage/media', () => ({
  pathOfFileUri: (uri: string) => uri.slice('file://'.length),
}));

describe('inputContent', () => {
  it('passes media flat to the phone TDLib', () => {
    expect(
      inputContent({ kind: 'file', uri: 'file:///tmp/a.pdf', name: 'a.pdf' }, false)
    ).toMatchObject({
      '@type': 'inputMessageDocument',
      document: { '@type': 'inputFileLocal', path: '/tmp/a.pdf' },
    });
  });

  it('wraps media for TDLib 1.8.67', () => {
    expect(
      inputContent({ kind: 'image', uri: 'file:///tmp/a.jpg', width: 3, height: 4 }, true)
    ).toMatchObject({
      '@type': 'inputMessagePhoto',
      photo: {
        '@type': 'inputPhoto',
        photo: { '@type': 'inputFileLocal', path: '/tmp/a.jpg' },
        width: 3,
        height: 4,
      },
    });
    expect(
      inputContent({ kind: 'voice', uri: 'file:///tmp/v.m4a', durationMs: 2_400 }, true)
    ).toMatchObject({
      '@type': 'inputMessageVoiceNote',
      voice_note: { '@type': 'inputVoiceNote', duration: 2 },
    });
  });

  it('sends a GIF as an animation so it keeps moving', () => {
    expect(
      inputContent({ kind: 'image', uri: 'file:///tmp/a.gif', mimeType: 'image/gif' }, true)
    ).toMatchObject({
      '@type': 'inputMessageAnimation',
      animation: { '@type': 'inputAnimation', animation: { path: '/tmp/a.gif' } },
    });
  });
});
