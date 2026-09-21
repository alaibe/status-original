import type { ThemeColors } from '@/design';

/** Desktop screens sit on the frame's wallpaper, so they paint nothing and do not slide. */
export function stackScreenOptions(_colors: ThemeColors) {
  return {
    contentStyle: { backgroundColor: 'transparent' },
    animation: 'none',
  } as const;
}
