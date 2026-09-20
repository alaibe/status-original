import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { Palette } from '../tokens';

export const FONT_SIZE_NAMES = [
  'micro',
  'caption',
  'footnote',
  'body',
  'title',
  'headline',
  'display',
] as const;

const COLOR_NAMES = Object.keys(Palette.light);

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_NAMES] }],
      'text-color': [{ text: COLOR_NAMES }],
      'bg-color': [{ bg: COLOR_NAMES }],
      'border-color': [{ border: COLOR_NAMES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
