import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

import type { MessageNotification } from './notifications';

export type { MessageNotification } from './notifications';

export function configureNotifications(): void {}

async function allowed(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

export async function notifyMessage(notification: MessageNotification): Promise<void> {
  try {
    if (!(await allowed())) return;
    sendNotification({ title: notification.title, body: notification.body });
  } catch (error) {
    console.warn('[notifications] could not post', error);
  }
}

let shownBadge: number | undefined;

/** The store reports on every change; the Dock only hears about a new count. */
export async function setBadgeCount(count: number): Promise<void> {
  if (count === shownBadge) return;
  shownBadge = count;
  try {
    await invoke('set_badge', { count });
  } catch {}
}

// The desktop plugin only posts: it has no tap event, so a click brings the
// window forward and no further.
export function onNotificationTapped(_handler: (conversationId: string) => void): () => void {
  return () => {};
}
