import { TdRequestError } from './api';

const INVITE_PREFIX = /^(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)/i;

export function isInviteLink(value: string): boolean {
  return INVITE_PREFIX.test(value.trim());
}

export function normalizeInviteLink(value: string): string {
  const link = value.trim();
  if (!INVITE_PREFIX.test(link) || !/^[A-Za-z0-9_-]+\/?$/.test(link.replace(INVITE_PREFIX, '')))
    throw new Error('Enter a Telegram invite link such as t.me/+code.');
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/** Null when the chat asks an administrator to approve the join first. */
export async function joinOrRequest<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof TdRequestError && error.message.includes('INVITE_REQUEST_SENT'))
      return null;
    throw error;
  }
}
