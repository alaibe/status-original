import type { PropsWithChildren } from 'react';

/** Phones present these routes as sheets; see dialog.web.tsx. */
export function Dialog({ children }: PropsWithChildren) {
  return <>{children}</>;
}
