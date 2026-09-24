import { persistLocalAttachment } from './attachments';
import { adoptMedia } from './media-store';

jest.mock('./media-store', () => ({
  ...jest.requireActual('./media-store'),
  adoptMedia: jest.fn(async () => 'file:///stored'),
}));

it('names a pending attachment with characters the media store accepts', async () => {
  await persistLocalAttachment(
    'pending:1790256373358:7b3cny',
    { kind: 'file', uri: 'file:///tmp/picked', name: 'my notes.txt' },
    'account'
  );

  expect(adoptMedia).toHaveBeenCalledWith(
    'attachments',
    'pending_1790256373358_7b3cny-my_notes.txt',
    'account',
    'file:///tmp/picked'
  );
});
