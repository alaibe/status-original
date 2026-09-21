import type { AccountStorage } from '@/storage/account';
import { fetchLinkPreview, type LinkPreview } from './link-preview';

const KEY = 'link-previews';
const LIMIT = 300;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_DELAY_MS = 500;

type Entry = { preview: LinkPreview | null; at: number };

let storage: AccountStorage | null = null;
let entries = new Map<string, Entry>();
const pending = new Map<string, Promise<LinkPreview | null>>();
let flush: ReturnType<typeof setTimeout> | null = null;

/** Reads the account's cache; nothing is fetched until this has run. */
export async function hydrateLinkPreviewCache(target: AccountStorage): Promise<void> {
  storage = target;
  entries = new Map();
  pending.clear();
  const saved = await target.get<Record<string, Entry>>(KEY).catch(() => null);
  if (storage !== target) return;
  const cutoff = Date.now() - TTL_MS;
  for (const [url, entry] of Object.entries(saved ?? {})) {
    if (entry.at > cutoff) entries.set(url, entry);
  }
}

export function clearLinkPreviewCache(): void {
  storage = null;
  entries = new Map();
  pending.clear();
  if (flush) clearTimeout(flush);
  flush = null;
}

export function cachedLinkPreview(url: string): LinkPreview | null | undefined {
  return entries.get(url)?.preview;
}

/** One request per URL, remembered across launches for a week. */
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const known = entries.get(url);
  if (known) return Promise.resolve(known.preview);

  let request = pending.get(url);
  if (!request) {
    const owner = storage;
    request = fetchLinkPreview(url).then((preview) => {
      if (storage === owner) {
        remember(url, preview);
        pending.delete(url);
      }
      return preview;
    });
    pending.set(url, request);
  }
  return request;
}

function remember(url: string, preview: LinkPreview | null): void {
  entries.delete(url);
  entries.set(url, { preview, at: Date.now() });
  while (entries.size > LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  if (flush) clearTimeout(flush);
  flush = setTimeout(persist, FLUSH_DELAY_MS);
}

function persist(): void {
  flush = null;
  const target = storage;
  if (!target) return;
  target.set(KEY, Object.fromEntries(entries)).catch((error) => {
    console.warn('[links] could not persist previews', error);
  });
}
