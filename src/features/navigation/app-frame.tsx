import type { PropsWithChildren } from 'react';

/** On a phone the routes fill the window. The desktop variant adds a sidebar. */
export function AppFrame({ children }: PropsWithChildren) {
  return <>{children}</>;
}
