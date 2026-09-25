import { toMessage } from './mapping';
import type { TdFile, TdMessage } from './types';

const file: TdFile = {
  '@type': 'file',
  id: 1,
  size: 10,
  local: { path: '/td/a', is_downloading_completed: true, is_downloading_active: false },
};

const animation = (mime_type: string): TdMessage => ({
  '@type': 'message',
  id: 5,
  chat_id: 7,
  sender_id: { '@type': 'messageSenderUser', user_id: 9 },
  date: 1,
  is_outgoing: false,
  content: {
    '@type': 'messageAnimation',
    animation: { animation: file, mime_type, width: 320, height: 240 },
    caption: { '@type': 'formattedText', text: '', entities: [] },
  },
});

const context = { media: (f: TdFile) => `file://${f.local.path}`, names: () => '' };

describe('Telegram animations', () => {
  it('plays an MP4 animation as a silent looping video', () => {
    expect(toMessage(animation('video/mp4'), context).content).toEqual({
      kind: 'video',
      uri: 'file:///td/a',
      width: 320,
      height: 240,
      gif: true,
    });
  });

  it('shows a real GIF as an image', () => {
    expect(toMessage(animation('image/gif'), context).content).toMatchObject({
      kind: 'image',
      mimeType: 'image/gif',
    });
  });
});
