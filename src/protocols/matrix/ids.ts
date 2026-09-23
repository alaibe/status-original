import type { ConversationId } from '@/core/messaging/types';

export const USER_ID = /^@[^:\s]+:[^\s]+$/;

export function parseRoomReference(input: string): { idOrAlias: string; via: string[] } | null {
  const value = input.trim();
  let idOrAlias = value;
  let via: string[] = [];
  if (/^(?:https?:\/\/)?matrix\.to\/#\//i.test(value)) {
    try {
      const url = new URL(value.startsWith('http') ? value : `https://${value}`);
      const [encoded, query] = url.hash.slice(2).split('?');
      idOrAlias = decodeURIComponent(encoded);
      via = new URLSearchParams(query).getAll('via');
    } catch {
      return null;
    }
  }
  return /^[#!][^:\s]+:[^\s]+$/.test(idOrAlias) ? { idOrAlias, via } : null;
}

/** A Matrix ID as people paste it: bare, a matrix.to link, or a matrix: URI. */
export function parseUserId(input: string): string | null {
  let value = input.trim();
  const permalink = value.match(/^(?:https?:\/\/)?matrix\.to\/#\/([^/?]+)/);
  if (permalink) value = decodeURIComponent(permalink[1]);
  const uri = value.match(/^matrix:u\/([^?]+)/);
  if (uri) value = `@${decodeURIComponent(uri[1])}`;
  if (/^[a-z0-9._=\/+-]+:[^\s]+$/i.test(value)) value = `@${value}`;
  return USER_ID.test(value) ? value : null;
}

export function serverName(userId: string): string {
  return userId.slice(userId.indexOf(':') + 1);
}

export function permalink(idOrAlias: string, via?: string): string {
  const link = `https://matrix.to/#/${encodeURIComponent(idOrAlias)}`;
  return via ? `${link}?via=${encodeURIComponent(via)}` : link;
}

export function localpart(userId: string): string {
  const match = userId.match(/^@([^:]+):/);
  return match ? match[1] : userId;
}

/** Room ids carry `!` and `:`, which conversation ids may not; base64url keeps them reversible. */
export function conversationIdOf(roomId: string): ConversationId {
  return globalThis.btoa(roomId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function roomIdOf(id: ConversationId): string {
  const padded = id.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (id.length % 4)) % 4);
  return globalThis.atob(padded);
}
