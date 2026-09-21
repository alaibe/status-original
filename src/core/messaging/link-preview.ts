import { previewFetch } from './preview-fetch';

export interface LinkPreview {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: { url: string; width?: number; height?: number };
  /** The picture is a poster frame; the card shows a play glyph over it. */
  video?: boolean;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Sites gate their Open Graph tags on a crawler user agent; naming one is the
// difference between a card and nothing. This is also what Telegram sends.
const USER_AGENT = 'Mozilla/5.0 (compatible; Status Original; like TwitterBot)';
const MAX_BYTES = 512 * 1024;
const TITLE_LIMIT = 200;
const DESCRIPTION_LIMIT = 400;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Only public hosts are fetched. A link to a LAN address or a bare IP would
 * otherwise turn the recipient's device into a probe for whoever sent it.
 */
export function isPreviewable(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (!host.includes('.')) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return false;
  return !/\.(local|localhost|internal|home|lan|arpa)$/.test(host);
}

export async function fetchLinkPreview(
  url: string,
  { fetchImpl = previewFetch, timeoutMs = 10_000 }: FetchOptions = {}
): Promise<LinkPreview | null> {
  if (!isPreviewable(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const request = (target: string, accept: string) =>
    fetchImpl(target, {
      signal: controller.signal,
      credentials: 'omit',
      headers: { accept, 'user-agent': USER_AGENT, range: `bytes=0-${MAX_BYTES - 1}` },
    });

  try {
    const video = youtubeId(url);
    if (video) {
      const response = await request(youtubeOembedUrl(url), 'application/json');
      return response.ok ? youtubePreview(url, video, await response.json()) : null;
    }

    const response = await request(url, 'text/html,application/xhtml+xml,image/*');
    if (!response.ok) return null;

    const type = response.headers.get('content-type') ?? '';
    const finalUrl = response.url || url;

    if (type.startsWith('image/')) return { url, image: { url: finalUrl } };
    if (!/text\/html|application\/xhtml/.test(type)) return null;

    const html = (await response.text()).slice(0, MAX_BYTES);
    return parseLinkPreview(html, finalUrl, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// YouTube's watch page is over a megabyte and ignores byte ranges; its oEmbed
// answer is a few hundred bytes and carries the title, channel and poster.
export function youtubeId(url: string): string | null {
  const match = url.match(
    /^https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i
  );
  return match ? match[1] : null;
}

function youtubeOembedUrl(url: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
}

function youtubePreview(url: string, id: string, body: unknown): LinkPreview | null {
  const data = (body ?? {}) as { title?: string; author_name?: string };
  if (!data.title) return null;
  return {
    url,
    siteName: 'YouTube',
    title: clean(data.title),
    description: data.author_name ? clean(data.author_name) : undefined,
    // hqdefault always exists; it is 4:3 with letterbox bars that a 16:9 crop removes.
    image: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 16, height: 9 },
    video: true,
  };
}

export function parseLinkPreview(html: string, pageUrl: string, url = pageUrl): LinkPreview | null {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) {
      meta.set(key, attrs.content);
    }
  }

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value?.trim()) return clean(value);
    }
    return undefined;
  };

  const title =
    pick('og:title', 'twitter:title') ??
    clean(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
  const description = pick('og:description', 'twitter:description', 'description');
  const imageUrl = pick('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src');
  const siteName = pick('og:site_name') ?? hostOf(pageUrl)?.replace(/^www\./, '');

  const preview: LinkPreview = { url };
  if (siteName) preview.siteName = siteName;
  if (title) preview.title = truncate(title, TITLE_LIMIT);
  if (description && description !== title) {
    preview.description = truncate(description, DESCRIPTION_LIMIT);
  }

  const image = imageUrl ? resolveUrl(imageUrl, pageUrl) : null;
  if (image) {
    preview.image = { url: image };
    const width = Number(meta.get('og:image:width'));
    const height = Number(meta.get('og:image:height'));
    if (width > 0 && height > 0) Object.assign(preview.image, { width, height });
  }

  return preview.title || preview.description || preview.image ? preview : null;
}

export function resolveUrl(candidate: string, pageUrl: string): string | null {
  const value = candidate.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  const origin = pageUrl.match(/^(https?:\/\/[^/?#]+)/i)?.[1];
  if (!origin) return null;

  if (value.startsWith('//')) return `${origin.split('//')[0]}${value}`;
  if (value.startsWith('/')) return `${origin}${value}`;

  const path = pageUrl.slice(origin.length).split(/[?#]/)[0];
  const directory = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  return `${origin}${directory}${value}`;
}

function hostOf(url: string): string | null {
  const host = url.match(/^https?:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i)?.[1];
  return host ? host.toLowerCase() : null;
}

function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function clean(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
