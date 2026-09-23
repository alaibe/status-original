import { pathOfFileUri } from './media.web';

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn(), convertFileSrc: jest.fn() }));

describe('pathOfFileUri on the desktop', () => {
  it('reads the path back out of an asset URL', () => {
    expect(pathOfFileUri('asset://localhost/%2FUsers%2Fme%2Fa%20b.jpg')).toBe('/Users/me/a b.jpg');
    expect(pathOfFileUri('http://asset.localhost/C%3A%5Cmedia%5Ca.jpg')).toBe('C:\\media\\a.jpg');
  });

  it('still takes file URIs', () => {
    expect(pathOfFileUri('file:///tmp/a%20b.pdf')).toBe('/tmp/a b.pdf');
  });
});
