import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const pub = new URL('../public/', import.meta.url);

fs.rmSync(pub, { recursive: true, force: true });
fs.cpSync(new URL('docs/public/', root), pub, { recursive: true });

const mark = fs.readFileSync(new URL('assets/brand/mark.svg', root), 'utf8');
const plate = mark.match(/data-plate="([^"]+)"/)[1];
const radius = mark.match(/data-radius="([^"]+)"/)[1];
const paths = mark.match(/<path[\s\S]*?\/>/g).join('');
fs.writeFileSync(
  new URL('logomark.svg', pub),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${plate}"/>${paths}</svg>`
);
