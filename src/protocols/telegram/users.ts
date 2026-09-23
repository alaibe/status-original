import type { TdUser } from './types';

export function handleOf(user: TdUser): string {
  const username = user.usernames?.active_usernames[0];
  if (username) return `@${username}`;
  if (user.phone_number) return `+${user.phone_number}`;
  return String(user.id);
}

export function nameOf(user: TdUser): string {
  if (user.type['@type'] === 'userTypeDeleted') return 'Deleted account';
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || handleOf(user);
}
