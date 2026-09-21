import type { AccountStorage } from '@/storage/account';

import {
  cachedLinkPreview,
  clearLinkPreviewCache,
  hydrateLinkPreviewCache,
  loadLinkPreview,
} from './link-preview-cache';
import * as fetcher from './link-preview';

jest.mock('./link-preview', () => ({
  ...jest.requireActual('./link-preview'),
  fetchLinkPreview: jest.fn(),
}));

const fetchLinkPreview = fetcher.fetchLinkPreview as jest.Mock;

function fakeStorage(saved: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(saved));
  return {
    accountId: 'a',
    get: jest.fn(async (name: string) => store.get(name) ?? null),
    set: jest.fn(async (name: string, value: unknown) => {
      store.set(name, value);
    }),
    store,
  } as unknown as AccountStorage & { store: Map<string, unknown> };
}

const preview = { url: 'https://a.co/', title: 'A' };

beforeEach(() => {
  jest.useFakeTimers();
  fetchLinkPreview.mockReset();
  clearLinkPreviewCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('link preview cache', () => {
  it('fetches a URL once, then answers from memory and persists', async () => {
    const storage = fakeStorage();
    await hydrateLinkPreviewCache(storage);
    fetchLinkPreview.mockResolvedValue(preview);

    const [first, second] = await Promise.all([
      loadLinkPreview('https://a.co/'),
      loadLinkPreview('https://a.co/'),
    ]);
    expect(first).toEqual(preview);
    expect(second).toEqual(preview);
    expect(fetchLinkPreview).toHaveBeenCalledTimes(1);
    expect(cachedLinkPreview('https://a.co/')).toEqual(preview);

    jest.runAllTimers();
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledWith(
      'link-previews',
      expect.objectContaining({ 'https://a.co/': expect.objectContaining({ preview }) })
    );

    expect(await loadLinkPreview('https://a.co/')).toEqual(preview);
    expect(fetchLinkPreview).toHaveBeenCalledTimes(1);
  });

  it('remembers a miss too, so a dead link is not retried every render', async () => {
    await hydrateLinkPreviewCache(fakeStorage());
    fetchLinkPreview.mockResolvedValue(null);
    expect(await loadLinkPreview('https://dead.example/')).toBeNull();
    expect(await loadLinkPreview('https://dead.example/')).toBeNull();
    expect(fetchLinkPreview).toHaveBeenCalledTimes(1);
    expect(cachedLinkPreview('https://dead.example/')).toBeNull();
    expect(cachedLinkPreview('https://never.example/')).toBeUndefined();
  });

  it('reloads saved entries and drops the ones older than a week', async () => {
    const now = Date.now();
    const storage = fakeStorage({
      'link-previews': {
        'https://fresh.example/': { preview, at: now - 1000 },
        'https://stale.example/': { preview, at: now - 8 * 24 * 60 * 60 * 1000 },
      },
    });
    await hydrateLinkPreviewCache(storage);
    expect(cachedLinkPreview('https://fresh.example/')).toEqual(preview);
    expect(cachedLinkPreview('https://stale.example/')).toBeUndefined();
  });

  it('forgets everything on clear and ignores a fetch that finishes for a previous account', async () => {
    await hydrateLinkPreviewCache(fakeStorage());
    let resolve: (value: typeof preview) => void = () => {};
    fetchLinkPreview.mockReturnValue(new Promise((r) => (resolve = r)));
    const request = loadLinkPreview('https://a.co/');

    clearLinkPreviewCache();
    const next = fakeStorage();
    await hydrateLinkPreviewCache(next);
    resolve(preview);
    await request;

    expect(cachedLinkPreview('https://a.co/')).toBeUndefined();
    jest.runAllTimers();
    expect(next.set).not.toHaveBeenCalled();
  });
});
