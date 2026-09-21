import type { SwipeableRowProps } from './swipeable-row';

export type { SwipeAction, SwipeableRowProps, SwipeTone } from './swipeable-row';

/** A mouse does not swipe; the same actions live in the row's context menu. */
export function SwipeableRow({ children }: SwipeableRowProps) {
  return <>{children}</>;
}
