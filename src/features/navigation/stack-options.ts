import type { ThemeColors } from '@/design';

/** Screens draw on the canvas and slide in; see stack-options.web.ts for the desktop. */
export function stackScreenOptions(colors: ThemeColors) {
  return {
    contentStyle: { backgroundColor: colors.canvas },
    animation: 'slide_from_right',
  } as const;
}
