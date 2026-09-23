import type { ParticipantId } from './types';

const SCHEME = 'mention:';

/**
 * A mention of someone by name rather than by handle, as Markdown the app
 * stores and renders: `[Name](mention:<participant id>)`. Each network turns
 * it into its own form (a Telegram entity, a Matrix pill) and back.
 */
export function mentionLink(name: string, id: ParticipantId): string {
  return `[${name.replace(/[[\]\\]/g, '\\$&')}](${mentionHref(id)})`;
}

export function mentionHref(id: ParticipantId): string {
  return `${SCHEME}${encodeURIComponent(id)}`;
}

export function mentionIdOf(href: string): ParticipantId | null {
  return href.startsWith(SCHEME) ? decodeId(href.slice(SCHEME.length)) : null;
}

export function decodeId(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    return null;
  }
}
