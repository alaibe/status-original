import * as Notifications from 'expo-notifications';

let configured = false;

export function configureNotifications(): void {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export interface MessageNotification {
  conversationId: string;
  title: string;
  body: string;
}

export async function notifyMessage(notification: MessageNotification): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: { conversationId: notification.conversationId },
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('[notifications] could not post', error);
  }
}

export async function setBadgeCount(count: number): Promise<void> {
  if (process.env.EXPO_OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {}
}

export function onNotificationTapped(handler: (conversationId: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.content.data?.conversationId;
    if (typeof id === 'string') handler(id);
  });
  return () => subscription.remove();
}
