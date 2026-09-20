/**
 * Draws the repeating motif behind a conversation and emits it as a base64 PNG
 * tile in src/design/components/chat-pattern-tile.ts.
 *
 * Why a generated tile instead of drawing the motif in React: one <View> per
 * dot is roughly 180 nodes behind every conversation, and every extra bit of
 * detail multiplies that. A tile is a single <Image>
 * with resizeMode="repeat", so the motif can be as dense as we like for a fixed
 * handful of nodes. The pixels carry only alpha, so the component tints them
 * from the palette at runtime and the pattern still follows the theme.
 *
 * Usage: npm run pattern:build
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'src', 'design', 'components', 'chat-pattern-tile.ts');

/**
 * Tile geometry. SIZE is pixels, SCALE is how many of those go into one point,
 * so the motif repeats every SIZE / SCALE pt.
 *
 * 2x rather than 3x on purpose: the pattern is drawn at ~5% opacity, where the
 * extra density is invisible, and dropping it more than halves the bytes we
 * inline into the bundle.
 */
const SIZE = 192;
const SCALE = 2;

/**
 * Antialiasing steps kept in the alpha channel. The tile is drawn at ~5%
 * opacity, so 15 steps of coverage is already finer than the display can
 * resolve, and quantising here roughly halves the deflated size, which is the
 * whole cost of inlining the tiles into the bundle.
 */
const ALPHA_STEPS = 15;

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

/**
 * Coverage buffer, 0..1 per pixel. Shapes are combined with max() rather than
 * added so overlapping strokes stay one flat tone: the motif has to read as a
 * single wash, and doubled-up ink at crossings is the kind of contrast that
 * would start competing with message text.
 */
function newBuffer() {
  return new Float64Array(SIZE * SIZE);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function blend(buf, x, y, cov) {
  if (cov <= 0) return;
  const i = y * SIZE + x;
  if (cov > buf[i]) buf[i] = cov;
}

/** Wrapping the write coordinates is what makes the tile seamless. */
function put(buf, x, y, cov) {
  blend(buf, ((x % SIZE) + SIZE) % SIZE, ((y % SIZE) + SIZE) % SIZE, cov);
}

/** Antialiased capsule between two points, `w` px wide. */
function segment(buf, ax, ay, bx, by, w) {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey || 1;
  const r = w / 2;
  const reach = Math.ceil(r + 1);

  // Only visit the pixels the capsule can reach; they get wrapped on write.
  const minX = Math.floor(Math.min(ax, bx) - reach);
  const maxX = Math.ceil(Math.max(ax, bx) + reach);
  const minY = Math.floor(Math.min(ay, by) - reach);
  const maxY = Math.ceil(Math.max(ay, by) + reach);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x - ax;
      const py = y - ay;
      const t = Math.max(0, Math.min(1, (px * ex + py * ey) / len2));
      const dx = px - ex * t;
      const dy = py - ey * t;
      const d = Math.sqrt(dx * dx + dy * dy) - r;
      put(buf, x, y, clamp01(0.5 - d));
    }
  }
}

/** Arc as a short chain of capsules, simpler to reason about than an arc SDF. */
function arc(buf, cx, cy, radius, from, to, w) {
  const span = Math.abs(to - from);
  const steps = Math.max(3, Math.ceil((span * radius) / 2));
  let px = cx + Math.cos(from) * radius;
  let py = cy + Math.sin(from) * radius;
  for (let i = 1; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const nx = cx + Math.cos(a) * radius;
    const ny = cy + Math.sin(a) * radius;
    segment(buf, px, py, nx, ny, w);
    px = nx;
    py = ny;
  }
}

function disc(buf, cx, cy, radius) {
  const reach = Math.ceil(radius + 1);
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) - radius;
      put(buf, x, y, clamp01(0.5 - d));
    }
  }
}

// ---------------------------------------------------------------------------
// Glyphs
//
// Each draws into `buf` around (cx, cy) at radius `r`, rotated by `a`. They are
// deliberately hand-drawn marks rather than geometric primitives: a grid of
// circles reads as a grid, but a scatter of little marks reads as texture.
// ---------------------------------------------------------------------------

/** Local glyph coordinates (-1..1) to tile coordinates. */
function place(cx, cy, r, a, lx, ly) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [cx + (lx * c - ly * s) * r, cy + (lx * s + ly * c) * r];
}

const GLYPHS = {
  ring: (buf, cx, cy, r, _a, w) => arc(buf, cx, cy, r * 0.78, 0, Math.PI * 2, w),

  crescent: (buf, cx, cy, r, a, w) => arc(buf, cx, cy, r * 0.85, a + 0.5, a + 4.4, w),

  // Two opposed arcs meeting at a point: a leaf, or a lens.
  leaf: (buf, cx, cy, r, a, w) => {
    const nx = Math.cos(a + Math.PI / 2);
    const ny = Math.sin(a + Math.PI / 2);
    const off = r * 0.85;
    arc(buf, cx - nx * off, cy - ny * off, r * 1.15, a - 0.72, a + 0.72, w);
    arc(buf, cx + nx * off, cy + ny * off, r * 1.15, a + Math.PI - 0.72, a + Math.PI + 0.72, w);
  },

  // Four strokes from a centre: a spark, the busiest mark in the set.
  spark: (buf, cx, cy, r, a, w) => {
    for (let i = 0; i < 4; i++) {
      const t = a + (i * Math.PI) / 2;
      segment(buf, cx, cy, cx + Math.cos(t) * r, cy + Math.sin(t) * r, w);
    }
  },

  // Three alternating half-arcs: a wave.
  squiggle: (buf, cx, cy, r, a, w) => {
    const step = r * 0.62;
    for (let i = 0; i < 3; i++) {
      const [px, py] = place(cx, cy, r, a, -0.62 + i * 0.62, 0);
      const up = i % 2 === 0;
      arc(buf, px, py, step * 0.5, a + (up ? Math.PI : 0), a + (up ? Math.PI * 2 : Math.PI), w);
    }
  },

  triangle: (buf, cx, cy, r, a, w) => {
    const pts = [0, 1, 2].map((i) => {
      const t = a + (i * Math.PI * 2) / 3 - Math.PI / 2;
      return [cx + Math.cos(t) * r * 0.9, cy + Math.sin(t) * r * 0.9];
    });
    for (let i = 0; i < 3; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % 3];
      segment(buf, x0, y0, x1, y1, w);
    }
  },

  chevron: (buf, cx, cy, r, a, w) => {
    for (const k of [-1, 1]) {
      const [ax, ay] = place(cx, cy, r, a, -0.55, 0);
      const [bx, by] = place(cx, cy, r, a, 0.55, k * 0.8);
      segment(buf, ax, ay, bx, by, w);
    }
  },

  // Three dots in a loose triangle, the quiet mark that gives the scatter air.
  seeds: (buf, cx, cy, r, a, w) => {
    for (let i = 0; i < 3; i++) {
      const t = a + (i * Math.PI * 2) / 3;
      disc(buf, cx + Math.cos(t) * r * 0.5, cy + Math.sin(t) * r * 0.5, w * 0.72);
    }
  },

  spiral: (buf, cx, cy, r, a, w) => {
    const turns = 1.7;
    const steps = 26;
    let px = cx;
    let py = cy;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * turns * Math.PI * 2;
      const rr = (i / steps) * r * 0.9;
      const nx = cx + Math.cos(t + a) * rr;
      const ny = cy + Math.sin(t + a) * rr;
      segment(buf, px, py, nx, ny, w);
      px = nx;
      py = ny;
    }
  },
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a rebuild produces byte-identical output. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Scatters glyphs over a jittered grid. A pure random scatter clumps and leaves
 * holes at this density; a plain grid reads as a grid. One glyph per cell with
 * jitter keeps the spacing even while breaking the alignment.
 */
function scatter(buf, { seed, cells, radius, width, names, jitter = 0.45 }) {
  const rand = rng(seed);
  const cell = SIZE / cells;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const name = names[Math.floor(rand() * names.length) % names.length];
      // Half-cell stagger on alternate rows. Without it the rows line up and
      // the eye picks out horizontal banding long before it sees the motif.
      const stagger = row % 2 ? 0.5 : 0;
      const cx = (col + 0.5 + stagger + (rand() - 0.5) * 2 * jitter) * cell;
      const cy = (row + 0.5 + (rand() - 0.5) * 2 * jitter) * cell;
      const r = radius * (0.78 + rand() * 0.5);
      GLYPHS[name](buf, cx, cy, r, rand() * Math.PI * 2, width);
    }
  }
}

const PATTERNS = {
  // Small enough to remain a texture behind message bubbles.
  doodles(buf) {
    scatter(buf, {
      seed: 0x5eed01,
      cells: 6,
      radius: 11,
      width: 2.0,
      names: ['ring', 'crescent', 'leaf', 'spark', 'squiggle', 'triangle', 'chevron', 'spiral'],
    });
    // A second, smaller layer fills the gaps the first one leaves.
    scatter(buf, {
      seed: 0x5eed02,
      cells: 6,
      radius: 5.5,
      width: 1.7,
      names: ['seeds', 'spark', 'ring', 'chevron', 'crescent'],
      jitter: 0.5,
    });
  },

  /** Quieter alternative: outlines only, closer to a watermark. */
  bubbles(buf) {
    scatter(buf, {
      seed: 0xb0bb1e,
      cells: 4,
      radius: 17,
      width: 2.0,
      names: ['ring', 'crescent'],
      jitter: 0.5,
    });
    scatter(buf, {
      seed: 0xb0bb2e,
      cells: 6,
      radius: 6.5,
      width: 1.7,
      names: ['ring', 'seeds'],
      jitter: 0.5,
    });
  },
};

// ---------------------------------------------------------------------------
// PNG encoding
//
// Written by hand rather than pulled from npm: this runs once at authoring time
// and a short encoder is cheaper than a dependency.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Grey + alpha, with grey pinned at 255. Only the alpha channel carries the
 * drawing: the component supplies the colour through tintColor, which is what
 * lets one tile serve both themes.
 */
function encodePng(buf) {
  const bpp = 2;
  const stride = SIZE * bpp;
  const raw = Buffer.alloc(stride * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    raw[i * 2] = 255;
    raw[i * 2 + 1] = Math.round(clamp01(buf[i]) * ALPHA_STEPS) * (255 / ALPHA_STEPS);
  }

  // Per-scanline adaptive filtering, the standard minimum-sum-of-absolute-
  // differences heuristic. Worth it here: it takes the constant grey channel to
  // all zeroes, which is most of the file.
  const filtered = Buffer.alloc((stride + 1) * SIZE);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));

  for (let y = 0; y < SIZE; y++) {
    raw.copy(line, 0, y * stride, (y + 1) * stride);
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = candidates[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const x = line[i];
        const v =
          f === 0
            ? x
            : f === 1
              ? x - a
              : f === 2
                ? x - b
                : f === 3
                  ? x - ((a + b) >> 1)
                  : x - paeth(a, b, c);
        out[i] = v & 0xff;
        score += out[i] < 128 ? out[i] : 256 - out[i];
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    filtered[y * (stride + 1)] = best;
    candidates[best].copy(filtered, y * (stride + 1) + 1);
    line.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 4; // colour type: grey + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const entries = Object.entries(PATTERNS).map(([name, draw]) => {
  const buf = newBuffer();
  draw(buf);
  return [name, encodePng(buf)];
});

const body = entries
  .map(([name, png]) => `  ${name}: 'data:image/png;base64,${png.toString('base64')}',`)
  .join('\n');

const ts = `/**
 * GENERATED FILE. Do not edit by hand.
 * Source: scripts/generate-chat-pattern.js   Regenerate: npm run pattern:build
 *
 * Alpha-only PNG tiles for the conversation backdrop, inlined as data URIs.
 * Inlined rather than shipped as image assets so there is one copy of each
 * motif instead of one per screen density, and so the colour stays a runtime
 * decision: the tiles carry no hue at all, only coverage.
 */

/** Pixels per point in the tiles, so each repeats every ${SIZE / SCALE}pt. */
export const CHAT_PATTERN_SCALE = ${SCALE};

/** Tile edge, in pixels. */
export const CHAT_PATTERN_SIZE = ${SIZE};

export const CHAT_PATTERNS = {
${body}
} as const;

export type ChatPatternName = keyof typeof CHAT_PATTERNS;
`;

fs.writeFileSync(outPath, ts);

// Exposed so a scratch script can composite a preview over the real palette
// when tuning the motif; nothing in the app imports this file.
module.exports = { SIZE, SCALE, PATTERNS, newBuffer };

const report = entries.map(([name, png]) => `${name} ${(png.length / 1024).toFixed(1)}kB`).join(', ');
console.log(
  `pattern: ${SIZE}px @${SCALE}x (${SIZE / SCALE}pt tile): ${report} -> ${path.relative(root, outPath)}`
);
