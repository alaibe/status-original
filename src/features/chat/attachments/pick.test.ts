import { contentFromBrowserFile } from './pick';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(() => 'blob:dropped'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
});

it('turns a pasted image into the existing attachment shape and enforces the size limit', async () => {
  const photo = new File(['photo'], 'photo.png', { type: 'image/png' });
  await expect(contentFromBrowserFile(photo, false)).resolves.toMatchObject({
    kind: 'image',
    uri: 'blob:dropped',
    name: 'photo.png',
    mimeType: 'image/png',
  });

  const large = new File([new Uint8Array(701 * 1024)], 'large.png', { type: 'image/png' });
  await expect(contentFromBrowserFile(large, false)).rejects.toThrow('The limit is');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dropped');
});

it('sends any other dropped file as a file, and a video as a video where the network can', async () => {
  const pdf = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
  await expect(contentFromBrowserFile(pdf, false)).resolves.toEqual({
    kind: 'file',
    uri: 'blob:dropped',
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    size: 4,
  });

  const clip = new File(['mp4'], 'clip.mp4', { type: 'video/mp4' });
  expect((await contentFromBrowserFile(clip, true)).kind).toBe('video');
  expect((await contentFromBrowserFile(clip, false)).kind).toBe('file');
});
