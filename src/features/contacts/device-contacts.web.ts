import { invoke } from '@tauri-apps/api/core';

import type { ContactAccess, DeviceContact } from './address-book';

export { contactSortKeyFor, type ContactAccess, type DeviceContact } from './address-book';

export function currentAccess(): Promise<ContactAccess> {
  return invoke<ContactAccess>('contacts_access');
}

export function askForAccess(): Promise<ContactAccess> {
  return invoke<ContactAccess>('contacts_request');
}

export async function readDeviceContacts(): Promise<DeviceContact[]> {
  const rows = await invoke<DeviceContact[]>('contacts_read');
  return rows.filter((c) => c.id && (c.given || c.family));
}

// macOS has no limited-access picker; the setting lives in System Settings.
export async function manageLimitedAccess(): Promise<void> {}
