import { readCredential, writeCredential } from '@/core/identity/credentials';

export const loadTokenKey = (accountId: string) => readCredential(accountId, 'tokens');
export const saveTokenKey = (accountId: string, key: string) =>
  writeCredential(accountId, 'tokens', key);
