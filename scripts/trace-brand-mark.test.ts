import { readFileSync } from 'node:fs';

import { Palette } from '../src/design/tokens';
import { OUT, trace } from './trace-brand-mark';

/**
 * The committed mark is what the tracer produces from the committed logo, so
 * the two cannot drift, and the trace is deterministic. Fails when either
 * changes without `npm run brand:build`.
 */
it('keeps assets/brand/mark.svg in step with the source logo', () => {
  const { markup } = trace();
  expect(markup).toBe(readFileSync(OUT, 'utf8'));
  expect(trace().markup).toBe(markup);
});

it('records what the generator needs on the root element', () => {
  const { markup } = trace();
  expect(markup).toMatch(/data-plate="#[0-9A-F]{6}"/);
  expect(markup).toMatch(/data-radius="\d+(\.\d)?"/);
  expect(markup).toMatch(/data-reach="\d+(\.\d)?"/);
  const path = /d="([^"]+)"/.exec(markup)?.[1] ?? '';
  expect(path.match(/M[\d.]+ [\d.]+/g)).toHaveLength(2);
});

it('is the colour the UI calls brand', () => {
  const plate = /data-plate="#([0-9A-F]{6})"/.exec(trace().markup)?.[1] ?? '';
  const rgb = [0, 2, 4].map((at) => parseInt(plate.slice(at, at + 2), 16)).join(' ');
  expect(Palette.light.brand).toBe(rgb);
  expect(Palette.light['bubble-out']).toBe(rgb);
});
