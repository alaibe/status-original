/**
 * Puts the XMTP WebAssembly binary where the desktop app fetches it from
 * (see src/desktop/xmtp-wasm-bindings.ts). `public/` is served by the dev
 * server and copied into `dist/` on export.
 */
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(
  __dirname,
  '..',
  'node_modules',
  '@xmtp',
  'wasm-bindings',
  'dist',
  'bindings_wasm_bg.wasm',
);
const target = path.join(__dirname, '..', 'public', 'xmtp', 'bindings_wasm_bg.wasm');

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
