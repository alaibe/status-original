export const Palette = {
  light: {
    // The logo's plate colour; assets/brand/mark.svg records it as data-plate.
    brand: '74 87 173',
    'brand-soft': '237 238 248',
    'brand-strong': '61 72 143',
    'brand-on': '255 255 255',

    canvas: '255 255 255',
    surface: '247 247 250',
    'surface-raised': '255 255 255',
    'surface-sunken': '240 240 245',

    content: '16 17 22',
    'content-muted': '96 100 108',
    'content-subtle': '142 146 156',

    line: '228 229 234',
    'line-strong': '208 210 218',

    'bubble-out': '74 87 173',
    'bubble-out-on': '255 255 255',
    'bubble-in': '240 240 245',
    'bubble-in-on': '16 17 22',

    success: '22 163 74',
    warning: '217 138 12',
    danger: '220 60 62',
  },
  dark: {
    brand: '149 160 228',
    'brand-soft': '27 30 55',
    'brand-strong': '177 186 241',
    'brand-on': '15 19 46',

    canvas: '9 9 13',
    surface: '20 20 27',
    'surface-raised': '29 29 38',
    'surface-sunken': '14 14 20',

    content: '244 244 248',
    'content-muted': '158 162 173',
    'content-subtle': '112 116 128',

    line: '38 39 49',
    'line-strong': '55 57 69',

    'bubble-out': '66 77 148',
    'bubble-out-on': '235 239 254',
    'bubble-in': '32 32 42',
    'bubble-in-on': '244 244 248',

    success: '74 222 128',
    warning: '240 170 45',
    danger: '248 96 98',
  },
} as const;

export type ThemeName = keyof typeof Palette;
export type TokenName = keyof (typeof Palette)['light'];

export function rgb(channels: string, alpha?: number) {
  return alpha === undefined ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

export type ResolvedColors = Record<TokenName, string>;

const RESOLVED: Record<ThemeName, ResolvedColors> = {
  light: Object.fromEntries(
    Object.entries(Palette.light).map(([k, v]) => [k, rgb(v)])
  ) as ResolvedColors,
  dark: Object.fromEntries(
    Object.entries(Palette.dark).map(([k, v]) => [k, rgb(v)])
  ) as ResolvedColors,
};

export function colorsFor(theme: ThemeName): ResolvedColors {
  return RESOLVED[theme];
}
