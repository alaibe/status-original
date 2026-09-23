import { decodeId, mentionHref } from './mentions';

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set(['br', 'hr', 'img']);
const BLOCK = new Set([
  'p',
  'div',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'sup',
  'details',
  'summary',
]);

/** The HTML a Matrix client sends as `formatted_body`, as the Markdown the app stores. */
export function htmlToMarkdown(html: string): string {
  return blocks(parse(html).children)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parse(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+|<)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const [whole, closing, rawTag, rawAttrs, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      top.children.push(decode(text));
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const element: Element = { tag, attrs: attributes(rawAttrs), children: [] };
    top.children.push(element);
    if (!VOID.has(tag) && !selfClosing && !whole.endsWith('/>')) stack.push(element);
  }
  return root;
}

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function blocks(nodes: Node[]): string[] {
  const out: string[] = [];
  let line = '';
  const flush = () => {
    const text = line
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim();
    if (text) out.push(escapeLineStarts(text));
    line = '';
  };

  for (const node of nodes) {
    if (typeof node === 'string' || !BLOCK.has(node.tag)) {
      line += inline(node);
      continue;
    }
    flush();
    out.push(...block(node));
  }
  flush();
  return out;
}

function block(el: Element): string[] {
  switch (el.tag) {
    case 'hr':
      return ['---'];
    case 'pre': {
      const code = el.children.find((c): c is Element => typeof c !== 'string' && c.tag === 'code');
      const lang = /language-(\S+)/.exec(code?.attrs.class ?? '')?.[1] ?? '';
      return [`\`\`\`${lang}\n${textContent(el).replace(/\n$/, '')}\n\`\`\``];
    }
    case 'blockquote': {
      const inner = blocks(el.children).join('\n\n');
      return inner ? [inner.replace(/^/gm, '> ').replace(/^> $/gm, '>')] : [];
    }
    case 'ul':
    case 'ol': {
      const start = Number(el.attrs.start) || 1;
      const items = el.children.filter(
        (c): c is Element => typeof c !== 'string' && c.tag === 'li'
      );
      return [
        items
          .map((item, i) => {
            const marker = el.tag === 'ol' ? `${start + i}. ` : '- ';
            const body = blocks(item.children).join('\n');
            return marker + body.replace(/\n/g, `\n${' '.repeat(marker.length)}`);
          })
          .join('\n'),
      ];
    }
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tr':
      return el.children.flatMap((c) => (typeof c === 'string' ? [] : block(c)));
    case 'td':
    case 'th':
      return [blocks(el.children).join('\n')].filter(Boolean);
    default:
      if (/^h[1-6]$/.test(el.tag)) {
        const text = blocks(el.children).join(' ');
        return text ? [`${'#'.repeat(+el.tag[1])} ${text}`] : [];
      }
      return blocks(el.children);
  }
}

function inline(node: Node): string {
  if (typeof node === 'string') return escapeInline(node.replace(/\s+/g, ' '));
  const inner = () => node.children.map(inline).join('');
  switch (node.tag) {
    case 'mx-reply':
      return '';
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return wrap(inner(), '**');
    case 'em':
    case 'i':
      return wrap(inner(), '*');
    case 'del':
    case 's':
    case 'strike':
      return wrap(inner(), '~~');
    case 'code': {
      const text = textContent(node);
      const fence = text.includes('`') ? '``' : '`';
      return text
        ? `${fence}${fence.length > 1 ? ' ' : ''}${text}${fence.length > 1 ? ' ' : ''}${fence}`
        : '';
    }
    case 'a': {
      const label = inner();
      const href = node.attrs.href ?? '';
      if (!href) return label;
      const pill = /^https:\/\/matrix\.to\/#\/(@[^?/]+)/.exec(href);
      const pilled = pill && decodeId(pill[1]);
      if (pill) return label.trim() && pilled ? `[${label}](${mentionHref(pilled)})` : label;
      if (!label.trim() || textContent(node) === href) return href;
      return `[${label}](${href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)})`;
    }
    case 'img':
      return escapeInline(node.attrs.alt ?? '');
    default:
      return inner();
  }
}

function wrap(text: string, marker: string): string {
  const core = text.trim();
  if (!core) return text;
  const lead = text.slice(0, text.indexOf(core[0]));
  const trail = text.slice(text.lastIndexOf(core[core.length - 1]) + 1);
  return `${lead}${marker}${core}${marker}${trail}`;
}

function textContent(node: Node): string {
  return typeof node === 'string' ? node : node.children.map(textContent).join('');
}

function escapeInline(text: string): string {
  return text.replace(/[\\*`[\]]|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_|~/gu, '\\$&');
}

function escapeLineStarts(text: string): string {
  return text.replace(/^(\s*)([>#]|[-+](?= )|\d+(?=[.)] ))/gm, (_, space: string, mark: string) =>
    /\d/.test(mark) ? `${space}${mark}\\` : `${space}\\${mark}`
  );
}
