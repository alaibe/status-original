import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';

import type { ContactAccess, DeviceContact } from './address-book';

export { contactSortKeyFor, type ContactAccess, type DeviceContact } from './address-book';

function toAccess(result: { granted: boolean; accessPrivileges?: string }): ContactAccess {
  if (!result.granted) return 'none';
  return (result.accessPrivileges as ContactAccess | undefined) ?? 'all';
}

export async function currentAccess(): Promise<ContactAccess> {
  return toAccess(await getPermissionsAsync());
}

export async function askForAccess(): Promise<ContactAccess> {
  return toAccess(await requestPermissionsAsync());
}

export async function readDeviceContacts(): Promise<DeviceContact[]> {
  const rows = await Contact.getAllDetails([
    ContactField.GIVEN_NAME,
    ContactField.FAMILY_NAME,
    ContactField.PHONES,
  ]);

  return rows
    .map((row) => ({
      id: String(row.id ?? ''),
      given: row.givenName ?? null,
      family: row.familyName ?? null,
      phone: row.phones?.[0]?.number ?? null,
    }))
    .filter((c) => c.id && (c.given || c.family));
}

export async function manageLimitedAccess(): Promise<void> {
  await Contact.presentAccessPicker();
}
