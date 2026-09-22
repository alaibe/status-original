#!/usr/bin/env node
/**
 * The mark, traced from the logo.
 *
 * `assets/brand/status-logo-2018.png` is a 512px raster: a rounded tile with
 * the white mark on it and a soft drop shadow. Nothing downstream can use a
 * raster (the iOS icon alone is 1024px), so this lifts the mark out as a
 * vector and records what it found (plate colour, tile corner radius) in
 * `assets/brand/mark.svg`, which is what `generate-brand-assets` renders from.
 *
 * Runs as the first step of `npm run brand:build`. No dependencies: the PNG
 * reader is next door in `lib/png.js`.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const { readPng } = require('./lib/png');

const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'assets/brand/status-logo-2018.png');
const OUT = join(ROOT, 'assets/brand/mark.svg');

const CANVAS = 512;
/** Canvas units between path points. Small enough that the blob tips survive. */
const SPACING = 3;
/** Smoothing passes: enough to take the pixel grid out of the long curves. */
const PASSES = 5;

/** Traces the mark out of the logo at `source`; the SVG comes back as text. */
function trace(source = SOURCE) {
  const png = readPng(readFileSync(source));

  // The tile, measured through the middle so the shadow does not widen it.
  const solid = (x, y) => png.at(x, y)[3] >= 250;
  const edge = (from, step, test) => {
    let at = from;
    while (!test(at)) at += step;
    return at;
  };
  const mid = Math.floor(png.height / 2);
  const tile = {
    left: edge(0, 1, (x) => solid(x, mid)),
    right: edge(png.width - 1, -1, (x) => solid(x, mid)),
    top: edge(0, 1, (y) => solid(Math.floor(png.width / 2), y)),
    bottom: edge(png.height - 1, -1, (y) => solid(Math.floor(png.width / 2), y)),
  };
  const tileWidth = tile.right - tile.left + 1;
  const centre = { x: (tile.left + tile.right + 1) / 2, y: (tile.top + tile.bottom + 1) / 2 };

  // Corner radius, from where the diagonal first meets the tile: a point on
  // the corner arc at 45° sits r(1 − 1/√2) in from the corner on each axis.
  const diagonal = edge(0, 1, (t) => solid(tile.left + t, tile.top + t));
  const radius = diagonal / (1 - Math.SQRT1_2);

  // Plate colour: the most common fully opaque colour that is not the mark.
  const votes = new Map();
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const [r, g, b, a] = png.at(x, y);
      if (a < 250 || Math.min(r, g, b) > 150) continue;
      const key = (r << 16) | (g << 8) | b;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }
  const plate = `#${[...votes.entries()]
    .sort((a, b) => b[1] - a[1])[0][0]
    .toString(16)
    .padStart(6, '0')
    .toUpperCase()}`;

  /**
   * How much of the mark's white a pixel holds, 0 to 1, so anti-aliased edges
   * land between rather than on a pixel boundary.
   */
  function whiteness(x, y) {
    const [r, g, b, a] = png.at(x, y);
    return (a / 255) * Math.min(1, Math.max(0, (Math.min(r, g, b) - 120) / 110));
  }

  // Marching squares over pixel centres, at the 0.5 level.
  const LEVEL = 0.5;
  const field = [];
  for (let y = 0; y < png.height; y++) {
    field.push(Array.from({ length: png.width }, (_, x) => whiteness(x, y)));
  }
  const cross = (ax, ay, av, bx, by, bv) => {
    const t = (LEVEL - av) / (bv - av);
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };

  const segments = [];
  for (let y = 0; y < png.height - 1; y++) {
    for (let x = 0; x < png.width - 1; x++) {
      const tl = field[y][x];
      const tr = field[y][x + 1];
      const br = field[y + 1][x + 1];
      const bl = field[y + 1][x];
      const index =
        (tl >= LEVEL ? 8 : 0) |
        (tr >= LEVEL ? 4 : 0) |
        (br >= LEVEL ? 2 : 0) |
        (bl >= LEVEL ? 1 : 0);
      if (index === 0 || index === 15) continue;

      const cx = x + 0.5;
      const cy = y + 0.5;
      const top = () => cross(cx, cy, tl, cx + 1, cy, tr);
      const right = () => cross(cx + 1, cy, tr, cx + 1, cy + 1, br);
      const bottom = () => cross(cx, cy + 1, bl, cx + 1, cy + 1, br);
      const left = () => cross(cx, cy, tl, cx, cy + 1, bl);

      // Each case lists the edges a contour crosses, inside kept on the left.
      switch (index) {
        case 1:
          segments.push([left(), bottom()]);
          break;
        case 2:
          segments.push([bottom(), right()]);
          break;
        case 3:
          segments.push([left(), right()]);
          break;
        case 4:
          segments.push([right(), top()]);
          break;
        case 5: {
          const inside = (tl + tr + br + bl) / 4 >= LEVEL;
          if (inside) {
            segments.push([left(), top()], [right(), bottom()]);
          } else {
            segments.push([left(), bottom()], [right(), top()]);
          }
          break;
        }
        case 6:
          segments.push([bottom(), top()]);
          break;
        case 7:
          segments.push([left(), top()]);
          break;
        case 8:
          segments.push([top(), left()]);
          break;
        case 9:
          segments.push([top(), bottom()]);
          break;
        case 10: {
          const inside = (tl + tr + br + bl) / 4 >= LEVEL;
          if (inside) {
            segments.push([top(), right()], [bottom(), left()]);
          } else {
            segments.push([top(), left()], [bottom(), right()]);
          }
          break;
        }
        case 11:
          segments.push([top(), right()]);
          break;
        case 12:
          segments.push([right(), left()]);
          break;
        case 13:
          segments.push([right(), bottom()]);
          break;
        case 14:
          segments.push([bottom(), left()]);
          break;
      }
    }
  }

  // Link segments into closed loops. Every crossing point belongs to exactly
  // two segments, so the walk does not depend on which way each one was drawn.
  const key = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const touching = new Map();
  for (const segment of segments) {
    for (const point of segment) {
      const list = touching.get(key(point)) ?? [];
      list.push(segment);
      touching.set(key(point), list);
    }
  }

  const loops = [];
  const used = new Set();
  for (const first of segments) {
    if (used.has(first)) continue;
    const loop = [];
    let current = first;
    let at = first[0];
    while (current && !used.has(current)) {
      used.add(current);
      loop.push(at);
      at = key(current[0]) === key(at) ? current[1] : current[0];
      current = (touching.get(key(at)) ?? []).find((s) => !used.has(s));
    }
    loops.push(loop);
  }

  // Into canvas space: the tile's width fills the canvas, the tile's centre is
  // the canvas centre, and the mark keeps its place on it.
  const scale = CANVAS / tileWidth;
  const toCanvas = ([x, y]) => [
    (x - centre.x) * scale + CANVAS / 2,
    (y - centre.y) * scale + CANVAS / 2,
  ];

  function resample(points, spacing) {
    const out = [];
    let carry = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let at = carry;
      while (at < length) {
        const t = at / length;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        at += spacing;
      }
      carry = at - length;
    }
    return out;
  }

  /** A 1-2-1 kernel, repeated. A point spacing apart stays put; the tips survive. */
  function smooth(points, passes) {
    let out = points;
    for (let pass = 0; pass < passes; pass++) {
      const n = out.length;
      const previous = out;
      out = previous.map((p, i) => {
        const before = previous[(i - 1 + n) % n];
        const after = previous[(i + 1) % n];
        return [(before[0] + 2 * p[0] + after[0]) / 4, (before[1] + 2 * p[1] + after[1]) / 4];
      });
    }
    return out;
  }

  const round = (v) => Math.round(v * 10) / 10;

  /** Catmull-Rom through every point, written as cubic Béziers. */
  function toPath(points) {
    const n = points.length;
    const parts = [`M${round(points[0][0])} ${round(points[0][1])}`];
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      parts.push(
        `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`
      );
    }
    parts.push('Z');
    return parts.join(' ');
  }

  const shapes = loops
    .filter((loop) => loop.length > 20)
    .map((loop) => smooth(resample(loop.map(toCanvas), SPACING), PASSES));
  const paths = shapes.map(toPath);

  // How far the mark reaches from the centre: what a circular launcher mask
  // would have to leave uncropped.
  const reach = Math.max(
    ...shapes.flat().map(([x, y]) => Math.hypot(x - CANVAS / 2, y - CANVAS / 2))
  );

  const markup = `<!--
    Generated by scripts/trace-brand-mark.js from status-logo-2018.png.
    Do not edit by hand: change the source image and run \`npm run brand:build\`.

    The mark is the only thing traced. What generate-brand-assets needs to know
    about the source tile is recorded on the root: its plate colour, its corner
    radius on this canvas, and how far the mark reaches from the centre.
  -->
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}"
       data-plate="${plate}" data-radius="${round(radius * scale)}" data-reach="${round(reach)}">
    <path fill="#FFFFFF" fill-rule="evenodd" d="${paths.join(' ')}"/>
  </svg>
  `;

  return {
    markup,
    summary:
      `mark.svg: ${paths.length} shapes, plate ${plate}, tile ${tileWidth}px, ` +
      `radius ${round(radius * scale)}, reach ${round(reach)} of ${CANVAS / 2}`,
  };
}

module.exports = { trace, SOURCE, OUT };

if (require.main === module) {
  const { markup, summary } = trace();
  writeFileSync(OUT, markup);
  console.log(summary);
}
