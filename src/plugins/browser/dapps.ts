import type { PluginContext } from '@/core/plugins/types';

import { FEATURED_DAPPS, type Dapp } from './config';

const STORAGE_OFF = 'dapps-off';
const STORAGE_CUSTOM = 'dapps-custom';

export async function allDapps(context: PluginContext): Promise<Dapp[]> {
  const custom = (await context.storage.get<Dapp[]>(STORAGE_CUSTOM)) ?? [];
  return [...FEATURED_DAPPS, ...custom.map((d) => ({ ...d, custom: true }))];
}

export async function offIds(context: PluginContext): Promise<string[]> {
  return (await context.storage.get<string[]>(STORAGE_OFF)) ?? [];
}

export async function enabledDapps(context: PluginContext): Promise<Dapp[]> {
  const off = new Set(await offIds(context));
  return (await allDapps(context)).filter((d) => !off.has(d.id));
}

export async function findDapp(context: PluginContext, query: string): Promise<Dapp | undefined> {
  const wanted = query.trim().toLowerCase();
  const dapps = await allDapps(context);
  return (
    dapps.find((d) => d.id === wanted) ??
    dapps.find((d) => d.name.toLowerCase() === wanted) ??
    dapps.find((d) => hostOf(d.url) === wanted.replace(/^www\./, ''))
  );
}

export async function setDappEnabled(
  context: PluginContext,
  id: string,
  on: boolean
): Promise<void> {
  const off = new Set(await offIds(context));
  if (on) off.delete(id);
  else off.add(id);
  await context.storage.set(STORAGE_OFF, [...off]);
}

export type AddResult = { dapp: Dapp } | { error: string };

export async function addDapp(
  context: PluginContext,
  rawUrl: string,
  rawName?: string
): Promise<AddResult> {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: `"${rawUrl}" is not a web address.` };
  }
  if (parsed.protocol !== 'https:') {
    return { error: 'A dapp has to be https: a page served in the clear can be rewritten.' };
  }

  const name = rawName?.trim() || parsed.host.replace(/^www\./, '');
  const id = slug(name);

  const existing = await allDapps(context);
  if (existing.some((d) => d.id === id)) {
    return { error: `You already have one called ${name}.` };
  }

  const dapp: Dapp = {
    id,
    name,
    url: parsed.toString().replace(/\/$/, ''),
    description: parsed.host.replace(/^www\./, ''),
    icon: 'globe-outline',
    custom: true,
  };

  const custom = (await context.storage.get<Dapp[]>(STORAGE_CUSTOM)) ?? [];
  await context.storage.set(STORAGE_CUSTOM, [...custom, dapp]);
  await setDappEnabled(context, id, true);
  return { dapp };
}

export async function removeDapp(
  context: PluginContext,
  id: string
): Promise<{ removed: Dapp } | { error: string }> {
  const custom = (await context.storage.get<Dapp[]>(STORAGE_CUSTOM)) ?? [];
  const target = custom.find((d) => d.id === id);
  if (!target) {
    return FEATURED_DAPPS.some((d) => d.id === id)
      ? { error: 'That one ships with the app, so it cannot be removed. Switch it off instead.' }
      : { error: 'No dapp with that name.' };
  }
  await context.storage.set(
    STORAGE_CUSTOM,
    custom.filter((d) => d.id !== id)
  );
  return { removed: target };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dapp';
}
