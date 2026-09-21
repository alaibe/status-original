export interface DeviceContact {
  id: string;
  given: string | null;
  family: string | null;
  phone: string | null;
}

/** `unavailable` is a system with no address book to ask, such as Windows. */
export type ContactAccess = 'unknown' | 'none' | 'limited' | 'all' | 'unavailable';

export function contactSortKeyFor(contact: DeviceContact, by: 'given' | 'family'): string {
  const first = (contact.given ?? '').trim();
  const last = (contact.family ?? '').trim();
  const parts = by === 'family' ? [last, first] : [first, last];
  return parts.filter(Boolean).join(' ').toLocaleLowerCase();
}
