import iamcal from 'emojibase-data/en/shortcodes/iamcal.json';

let byName: Map<string, string> | undefined;

function names(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  for (const [hex, value] of Object.entries(iamcal as Record<string, string | string[]>)) {
    const points = hex.split('-').map((h) => parseInt(h, 16));
    // A lone symbol below the emoji planes renders as text without the emoji selector.
    const emoji =
      String.fromCodePoint(...points) + (points.length === 1 && points[0] < 0x1f000 ? '️' : '');
    for (const name of Array.isArray(value) ? value : [value]) byName.set(name, emoji);
  }
  return byName;
}

export const SHORTCODE = /:([a-z0-9_+-]+):/g;

/** Slack-style `:name:` shortcodes as the emoji they stand for; unknown names stay as typed. */
export function replaceShortcodes(text: string): string {
  if (!text.includes(':')) return text;
  return text.replace(SHORTCODE, (whole, name: string) => names().get(name) ?? whole);
}
