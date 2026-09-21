import { createContext, useContext } from 'react';

/**
 * What the desktop frame keeps for itself: the sidebar along the left edge,
 * which overlays centre beside, and the drag strip along the top, which
 * screen headers start below.
 */
export const LayoutInsetsContext = createContext({ left: 0, top: 0 });

export function useLayoutInsets() {
  return useContext(LayoutInsetsContext);
}
