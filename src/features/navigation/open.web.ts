import { router, type Href } from 'expo-router';

// The desktop has no back button: the sidebar decides what the pane shows, so
// whatever was stacked above the tabs goes first. Left in place, each click
// would add a screen, and a dismissed dialog would keep the pane beneath it
// visible under the conversation.
function fresh(): void {
  if (router.canDismiss()) router.dismissAll();
}

export function openChat(id: string): void {
  fresh();
  router.navigate(`/chat/${id}`);
}

export const openChatFromSheet = openChat;
export const openChatFromProfile = openChat;

export function openTab(href: Href): void {
  fresh();
  router.navigate(href);
}
