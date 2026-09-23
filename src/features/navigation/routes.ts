/** Routes a phone presents as sheets and the desktop shows as dialogs over the pane. */
export const DIALOG_ROUTES = new Set([
  'new-chat',
  'invite',
  'qr',
  'profile/[id]',
  'bridge-login',
  'search',
]);

/** The first segment of each dialog route, as `useSegments` reports it. */
export const DIALOG_SEGMENTS = new Set([...DIALOG_ROUTES].map((route) => route.split('/')[0]));

export const FULL_WINDOW_ROUTES = new Set(['index', '(onboarding)', 'recover']);
