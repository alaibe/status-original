import { fetchLinkPreview, isPreviewable, parseLinkPreview, resolveUrl, youtubeId } from './link-preview';

const page = (head: string) => `<!doctype html><html><head>${head}</head><body>hi</body></html>`;

describe('parseLinkPreview', () => {
  it('reads Open Graph tags and image dimensions', () => {
    const html = page(`
      <meta property="og:site_name" content="GitHub" />
      <meta property="og:title" content="GitHub - tauri-apps/tauri" />
      <meta property="og:description" content="Build smaller, faster apps" />
      <meta property="og:image" content="https://img.example/tauri.png" />
      <meta property="og:image:width" content="1280" />
      <meta property="og:image:height" content="640" />
      <title>ignored</title>
    `);
    expect(parseLinkPreview(html, 'https://github.com/tauri-apps/tauri')).toEqual({
      url: 'https://github.com/tauri-apps/tauri',
      siteName: 'GitHub',
      title: 'GitHub - tauri-apps/tauri',
      description: 'Build smaller, faster apps',
      image: { url: 'https://img.example/tauri.png', width: 1280, height: 640 },
    });
  });

  it('falls back to twitter tags, the title tag, meta description and the host', () => {
    const html = page(`
      <meta name='twitter:image' content='/card.jpg'>
      <meta name=description content="A plain description">
      <title>Plain &amp; simple</title>
    `);
    expect(parseLinkPreview(html, 'https://www.example.com/a/b?x=1')).toEqual({
      url: 'https://www.example.com/a/b?x=1',
      siteName: 'example.com',
      title: 'Plain & simple',
      description: 'A plain description',
      image: { url: 'https://www.example.com/card.jpg' },
    });
  });

  it('decodes entities, collapses whitespace and drops a description equal to the title', () => {
    const html = page(`
      <meta property="og:title" content="The post you&#x27;re   looking&#8230; &nbsp;for" />
      <meta property="og:description" content="The post you're looking… for" />
    `);
    expect(parseLinkPreview(html, 'https://x.com/a/status/1')).toEqual({
      url: 'https://x.com/a/status/1',
      siteName: 'x.com',
      title: "The post you're looking… for",
    });
  });

  it('keeps the original link as the card url when the page redirected', () => {
    const html = page(`<meta property="og:title" content="Landed" />`);
    expect(parseLinkPreview(html, 'https://final.example/x', 'https://short.example/y')?.url).toBe(
      'https://short.example/y'
    );
  });

  it('returns null when there is nothing to show', () => {
    expect(parseLinkPreview(page('<meta name="viewport" content="width=device-width">'), 'https://a.co')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('resolves relative image locations against the page', () => {
    expect(resolveUrl('/img/a.png', 'https://a.co/blog/post')).toBe('https://a.co/img/a.png');
    expect(resolveUrl('a.png', 'https://a.co/blog/post')).toBe('https://a.co/blog/a.png');
    expect(resolveUrl('//cdn.a.co/a.png', 'https://a.co/blog/post')).toBe('https://cdn.a.co/a.png');
    expect(resolveUrl('http://b.co/a.png', 'https://a.co')).toBe('http://b.co/a.png');
    expect(resolveUrl('data:image/png;base64,AAAA', 'https://a.co')).toBeNull();
  });
});

describe('isPreviewable', () => {
  it('only allows public hosts', () => {
    expect(isPreviewable('https://x.com/jack')).toBe(true);
    expect(isPreviewable('http://192.168.1.1/admin')).toBe(false);
    expect(isPreviewable('http://localhost:8081/')).toBe(false);
    expect(isPreviewable('http://router.local/')).toBe(false);
    expect(isPreviewable('http://[::1]/')).toBe(false);
    expect(isPreviewable('ftp://a.co/')).toBe(false);
  });
});

describe('fetchLinkPreview', () => {
  const respond = (body: string, headers: Record<string, string>, ok = true, url = '') =>
    ({
      ok,
      url,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => body,
    }) as unknown as Response;

  it('sends a crawler user agent, no cookies and a byte range', async () => {
    const fetchImpl = jest.fn(async () =>
      respond(page('<meta property="og:title" content="T">'), { 'content-type': 'text/html; charset=utf-8' })
    );
    await fetchLinkPreview('https://a.co/', { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/TwitterBot/);
    expect((init.headers as Record<string, string>).range).toBe('bytes=0-524287');
  });

  it('shows a direct image link as its own card', async () => {
    const fetchImpl = jest.fn(async () =>
      respond('', { 'content-type': 'image/png' }, true, 'https://cdn.a.co/final.png')
    );
    expect(await fetchLinkPreview('https://a.co/pic.png', { fetchImpl })).toEqual({
      url: 'https://a.co/pic.png',
      image: { url: 'https://cdn.a.co/final.png' },
    });
  });

  it('returns null for errors, non-HTML bodies and private hosts without fetching them', async () => {
    const failing = jest.fn(async () => respond('', { 'content-type': 'text/html' }, false));
    expect(await fetchLinkPreview('https://a.co/', { fetchImpl: failing })).toBeNull();

    const json = jest.fn(async () => respond('{}', { 'content-type': 'application/json' }));
    expect(await fetchLinkPreview('https://a.co/', { fetchImpl: json })).toBeNull();

    const untouched = jest.fn();
    expect(await fetchLinkPreview('http://10.0.0.1/', { fetchImpl: untouched })).toBeNull();
    expect(untouched).not.toHaveBeenCalled();

    const throwing = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    expect(await fetchLinkPreview('https://a.co/', { fetchImpl: throwing })).toBeNull();
  });
});

describe('youtubeId', () => {
  it('finds the video id in the link shapes YouTube hands out', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(youtubeId(url)).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeId('https://www.youtube.com/@RickAstleyYT')).toBeNull();
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('fetchLinkPreview for YouTube', () => {
  it('asks oEmbed instead of the watch page and marks the card as a video', async () => {
    const fetchImpl = jest.fn(async () =>
      ({
        ok: true,
        url: '',
        headers: { get: () => 'application/json' },
        json: async () => ({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' }),
        text: async () => '',
      }) as unknown as Response
    );
    const preview = await fetchLinkPreview('https://youtu.be/dQw4w9WgXcQ', { fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&format=json'
    );
    expect(preview).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      siteName: 'YouTube',
      title: 'Never Gonna Give You Up',
      description: 'Rick Astley',
      image: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: 16, height: 9 },
      video: true,
    });
  });
});
