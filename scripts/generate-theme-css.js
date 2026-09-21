/**
 * Generates the token block in src/global.css from src/design/tokens.ts so the
 * TypeScript palette and the CSS variables can never drift apart.
 *
 * Usage: npm run theme:build
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tokensPath = path.join(root, 'src', 'design', 'tokens.ts');
const cssPath = path.join(root, 'src', 'global.css');

// Pull the two palette objects out of the TS source without needing a compiler.
const source = fs.readFileSync(tokensPath, 'utf8');

function parseTheme(name) {
  const start = source.indexOf(`${name}: {`);
  if (start === -1) throw new Error(`Could not find "${name}" palette in tokens.ts`);
  const end = source.indexOf('\n  },', start);
  if (end === -1) throw new Error(`Unterminated "${name}" palette in tokens.ts`);
  const body = source.slice(start, end);

  const entries = [...body.matchAll(/'?([a-z-]+)'?:\s*'([\d\s]+)'/g)].map((m) => [m[1], m[2]]);
  if (entries.length === 0) throw new Error(`No tokens parsed from "${name}" palette`);
  return entries;
}

const light = parseTheme('light');
const dark = parseTheme('dark');

const lightKeys = light.map(([k]) => k).join(',');
const darkKeys = dark.map(([k]) => k).join(',');
if (lightKeys !== darkKeys) {
  throw new Error('light and dark palettes must define exactly the same tokens');
}

const vars = (entries) => entries.map(([k, v]) => `    --color-${k}: ${v};`).join('\n');

const css = `@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * GENERATED FILE. Do not edit the token blocks by hand.
 * Source: src/design/tokens.ts   Regenerate: npm run theme:build
 */
@layer base {
  :root {
    --font-display:
      Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji,
      Segoe UI Symbol, Noto Color Emoji;
    --font-mono:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;
    --font-rounded: 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif;

${vars(light)}
  }

  .dark:root {
${vars(dark)}
  }

  /* Desktop: the app draws its own focus states. Keyboard focus keeps the ring. */
  input,
  textarea,
  :focus:not(:focus-visible) {
    outline: none;
  }
}
`;

fs.writeFileSync(cssPath, css);
console.log(`theme: wrote ${light.length} tokens x 2 themes -> ${path.relative(root, cssPath)}`);
