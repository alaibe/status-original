import type { ConversationId } from '@/core/messaging/types';

export const USER_ID = /^@[^:\s]+:[^\s]+$/;

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
