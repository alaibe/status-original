#!/usr/bin/env node
/**
 * Every store asset, from one drawing.
 *
 * The mark lives once in `assets/brand/mark.svg`, traced from the logo by
 * `trace-brand-mark.js`; this renders the sizes and croppings each platform
 * demands, and writes the plate colour into the three places `app.json`
 * repeats it. Keeping all of it generated rather than checked in by hand means
 * the files cannot drift apart, which is what happens when someone tweaks the
 * icon and forgets the monochrome layer nobody looks at until an Android 13
 * phone themes it into a smudge.
 *
 * Requires librsvg (`brew install librsvg`). Deliberately not an npm
 * dependency: this runs when the brand changes, which is roughly never, and a
 * native image toolchain in `node_modules` is a cost paid on every install.
 *
 *   npm run brand:build
 */
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const MARK = join(ROOT, 'assets/brand/mark.svg');
const OUT = join(ROOT, 'assets/images');
const STORE = join(ROOT, 'distribution/play');
const APP_JSON = join(ROOT, 'app.json');
const TMP = join(ROOT, 'node_modules/.cache/brand');

const CANVAS = 512;
const INK = '#FFFFFF';
/** The dark splash background; the dark app icon sits on the same colour. */
const NIGHT = '#141A3A';

const mark = readFileSync(MARK, 'utf8');
const attribute = (name) => {
  const match = new RegExp(`${name}="([^"]+)"`).exec(mark);
  if (!match) throw new Error(`mark.svg has no ${name}; run trace-brand-mark first`);
  return match[1];
};
const PLATE = attribute('data-plate');
const RADIUS = Number(attribute('data-radius'));
const REACH = Number(attribute('data-reach'));
const PATH = attribute(' d');

// Android crops the adaptive layers to whatever shape the launcher picks; a
// circle keeps only the central 66dp of 108, so the mark is inset to sit
// inside that with a little to spare.
const SAFE_RADIUS = (CANVAS / 2) * (66 / 108);
const ADAPTIVE_SCALE = Math.min(1, (0.96 * SAFE_RADIUS) / REACH);

// macOS applies no mask: the Dock expects a rounded tile on a transparent
// canvas, 824 of 1024 across, with Apple's own corner radius so it lines up
// with every other icon.
const DESKTOP_TILE = 824 / 1024;
const DESKTOP_RADIUS = 185.4 / 1024;

/**
 * @param plate  What the mark sits on: a colour, or nothing for transparency.
 * @param shape  How the plate is cut. iOS masks its own icon, so `square`;
 *               the web and the in-app avatar draw their own corners, and
 *               `desktop` is the inset macOS tile.
 * @param scale  1 places the mark exactly as the logo does; below 1 insets it.
 * @param mark   False draws the plate alone.
 */
function svg({ plate, shape = 'square', scale = 1, mark = true }) {
  const half = CANVAS / 2;
  const plates = {
    square: `<rect width="${CANVAS}" height="${CANVAS}" fill="${plate}"/>`,
    rounded: `<rect width="${CANVAS}" height="${CANVAS}" rx="${RADIUS}" fill="${plate}"/>`,
    circle: `<circle cx="${half}" cy="${half}" r="${half}" fill="${plate}"/>`,
    desktop: `<rect x="${(CANVAS * (1 - DESKTOP_TILE)) / 2}" y="${(CANVAS * (1 - DESKTOP_TILE)) / 2}" width="${CANVAS * DESKTOP_TILE}" height="${CANVAS * DESKTOP_TILE}" rx="${CANVAS * DESKTOP_RADIUS}" fill="${plate}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  ${plate ? plates[shape] : ''}
  ${
    mark
      ? `<path fill="${INK}" fill-rule="evenodd"
        transform="translate(${half} ${half}) scale(${scale}) translate(${-half} ${-half})"
        d="${PATH}"/>`
      : ''
  }
</svg>`;
}

/** A wide plate with the mark centred on it, as tall as the plate allows. */
function banner({ width, height, plate }) {
  const scale = height / CANVAS;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${plate}"/>
  <path fill="${INK}" fill-rule="evenodd"
        transform="translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-CANVAS / 2} ${-CANVAS / 2})"
        d="${PATH}"/>
</svg>`;
}

function render(name, markup, width, height = width, dir = OUT) {
  const source = join(TMP, `${name}.svg`);
  writeFileSync(source, markup);
  execFileSync('rsvg-convert', [
    '-w',
    String(width),
    '-h',
    String(height),
    source,
    '-o',
    join(dir, `${name}.png`),
  ]);
  console.log(`  ${name}.png  ${width}x${height}`);
}

mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(STORE, { recursive: true });

console.log(`brand assets (plate ${PLATE}, adaptive inset ${ADAPTIVE_SCALE.toFixed(2)}):`);

// iOS: full bleed and square. Apple applies its own corner mask, and Expo
// strips the alpha channel during prebuild, since App Store Connect rejects
// an icon that still has one. Dark and tinted variants for iOS 18's appearance
// modes: the dark one on the night colour, the tinted one in the grayscale the
// system expects before it applies the person's accent.
render('icon', svg({ plate: PLATE }), 1024);
render('icon-dark', svg({ plate: NIGHT }), 1024);
render('icon-tinted', svg({ plate: '#000000' }), 1024);

// Android adaptive: background and foreground are separate layers.
render('adaptive-icon-background', svg({ plate: PLATE, mark: false }), 512);
render('adaptive-icon-foreground', svg({ plate: null, scale: ADAPTIVE_SCALE }), 512);
// Themed icons on Android 13+: one colour, alpha decides the shape.
render('adaptive-icon-monochrome', svg({ plate: null, scale: ADAPTIVE_SCALE }), 432);

// Splash and notifications draw the mark alone on a colour set in app.json.
render('splash-icon', svg({ plate: null }), 512);
render('notification-icon', svg({ plate: null, scale: 0.85 }), 96);

// Web: the tile as the logo draws it, corners included.
render('favicon', svg({ plate: PLATE, shape: 'rounded' }), 64);

// Desktop: `tauri icon` cuts this into the .icns, .ico and PNG set in
// src-tauri/icons; see `brand:build`.
render('icon-desktop', svg({ plate: PLATE, shape: 'desktop', scale: DESKTOP_TILE }), 1024);

// The Status room's avatar in the chat list, header and pickers: a circle,
// since that is what every other avatar is. 96pt at 3x.
render('status-avatar', svg({ plate: PLATE, shape: 'circle' }), 288);

// Google Play's listing: a 512 icon it masks itself, and the 1024×500 feature
// graphic it will not publish without. Both opaque, as Play requires.
render('icon', svg({ plate: PLATE }), 512, 512, STORE);
render('feature-graphic', banner({ width: 1024, height: 500, plate: PLATE }), 1024, 500, STORE);

rmSync(TMP, { recursive: true, force: true });

// The same colour is repeated in app.json for the parts of the icon and
// splash the native side paints itself, and as Android's primary colour. Set
// them from here so a new logo cannot leave an old colour behind. The UI's
// `brand` token in src/design/tokens.ts is the same colour by convention; a
// test holds the two together.
const config = JSON.parse(readFileSync(APP_JSON, 'utf8'));
config.expo.primaryColor = PLATE;
config.expo.android.adaptiveIcon.backgroundColor = PLATE;
for (const plugin of config.expo.plugins) {
  if (!Array.isArray(plugin)) continue;
  const [name, options] = plugin;
  if (name === 'expo-splash-screen') {
    options.backgroundColor = PLATE;
    options.dark = { ...options.dark, backgroundColor: NIGHT };
  }
  if (name === 'expo-notifications') options.color = PLATE;
}
writeFileSync(APP_JSON, `${JSON.stringify(config, null, 2)}\n`);
console.log(`  app.json  primary, icon and splash colours set to ${PLATE} / ${NIGHT}`);
console.log('done');
