import type { PluginContext } from '@/core/plugins/types';

import { SUGGESTED_BOOKMARKS, type Bookmark } from './config';

const STORAGE_HIDDEN = 'bookmarks-hidden';
const STORAGE_CUSTOM = 'bookmarks-custom';

async function custom(context: PluginContext): Promise<Bookmark[]> {
  const saved = (await context.storage.get<Bookmark[]>(STORAGE_CUSTOM)) ?? [];
  return saved.map((b) => ({ ...b, custom: true }));
}

async function hidden(context: PluginContext): Promise<Set<string>> {
  return new Set((await context.storage.get<string[]>(STORAGE_HIDDEN)) ?? []);
}

async function setHidden(context: PluginContext, id: string, on: boolean): Promise<void> {
  const ids = await hidden(context);
  if (on) ids.add(id);
  else ids.delete(id);
  await context.storage.set(STORAGE_HIDDEN, [...ids]);
}

/** Suggested ones the user has not hidden, then their own. */
export async function bookmarks(context: PluginContext): Promise<Bookmark[]> {
  const off = await hidden(context);
  return [...SUGGESTED_BOOKMARKS.filter((b) => !off.has(b.id)), ...(await custom(context))];
}

/** Matches an id, a name or a host, among hidden suggestions too. */
export async function findBookmark(
  context: PluginContext,
  query: string
): Promise<Bookmark | undefined> {
  const wanted = query.trim().toLowerCase();
  const all = [...SUGGESTED_BOOKMARKS, ...(await custom(context))];
  return (
    all.find((b) => b.id === wanted) ??
    all.find((b) => b.name.toLowerCase() === wanted) ??
    all.find((b) => hostOf(b.url) === wanted.replace(/^www\./, ''))
  );
}

export type AddResult = { bookmark: Bookmark; restored?: boolean } | { error: string };

/** Adds a site, or brings back a suggested one that was removed. */
export async function addBookmark(
  context: PluginContext,
  rawUrl: string,
  rawName?: string
): Promise<AddResult> {
  const suggested = await findBookmark(context, rawUrl);
  if (suggested && !suggested.custom) {
    if (!(await hidden(context)).has(suggested.id)) {
      return { error: `${suggested.name} is already bookmarked.` };
    }
    await setHidden(context, suggested.id, false);
    return { bookmark: suggested, restored: true };
  }

  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: `"${rawUrl}" is not a web address.` };
  }
  if (parsed.protocol !== 'https:') {
    return { error: 'A bookmark has to be https: a page served in the clear can be rewritten.' };
  }

  const name = rawName?.trim() || parsed.host.replace(/^www\./, '');
  const id = slug(name);

  const existing = [...SUGGESTED_BOOKMARKS, ...(await custom(context))];
  if (existing.some((b) => b.id === id)) {
    return { error: `You already have one called ${name}.` };
  }

  const bookmark: Bookmark = {
    id,
    name,
    url: parsed.toString().replace(/\/$/, ''),
    description: parsed.host.replace(/^www\./, ''),
    icon: 'globe-outline',
    custom: true,
  };

  const saved = (await context.storage.get<Bookmark[]>(STORAGE_CUSTOM)) ?? [];
  await context.storage.set(STORAGE_CUSTOM, [...saved, bookmark]);
  return { bookmark };
}

/** Removes one of the user's own, or hides a suggested one. */
export async function removeBookmark(context: PluginContext, bookmark: Bookmark): Promise<void> {
  if (!bookmark.custom) {
    await setHidden(context, bookmark.id, true);
    return;
  }
  const saved = (await context.storage.get<Bookmark[]>(STORAGE_CUSTOM)) ?? [];
  await context.storage.set(
    STORAGE_CUSTOM,
    saved.filter((b) => b.id !== bookmark.id)
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bookmark';
}
