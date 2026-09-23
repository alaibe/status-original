import { Marked, type Token, type Tokens } from 'marked';

import { replaceShortcodes, SHORTCODE } from './shortcodes';

export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

export interface Span {
  text: string;
  style: SpanStyle;
  /** Only for links written as `[label](url)`; bare URLs stay text and are found later. */
  href?: string;
}

export type Block = (
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'rule' }
) & {
  /** A blank line separated it from the block before. */
  spaced?: boolean;
};

// Chat text is not a document: indentation and underlined lines are not code
// or headings there, so those two CommonMark rules are off.
const marked = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    code: () => undefined,
    lheading: () => undefined,
  },
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
});

const MARKUP = /[*_~`>#[\\]|^\s*(?:[-+]|\d+[.)])\s/m;

export function hasMarkup(text: string): boolean {
  return MARKUP.test(text);
}

const hasShortcode = (text: string) => text.includes(':') && new RegExp(SHORTCODE).test(text);

export function parseMarkdown(text: string): Block[] {
  if (!hasMarkup(text)) {
    return [{ kind: 'paragraph', spans: [{ text: replaceShortcodes(text), style: {} }] }];
  }
  return blocks(marked.lexer(text));
}

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = [];
  let spaced = false;
  for (const token of tokens) {
    if (token.type === 'space') {
      spaced = out.length > 0;
      continue;
    }
    const block = toBlock(token);
    if (!block) continue;
    const last = out.at(-1);
    // Bridges send one quote per paragraph; a reader sees a single quote.
    if (block.kind === 'quote' && last?.kind === 'quote') {
      if (block.blocks[0]) block.blocks[0].spaced = spaced;
      last.blocks.push(...block.blocks);
      spaced = false;
      continue;
    }
    if (spaced) block.spaced = true;
    spaced = false;
    out.push(block);
  }
  return out;
}

function toBlock(token: Token): Block | null {
  switch (token.type) {
    case 'paragraph':
    case 'text':
      return { kind: 'paragraph', spans: inline(token.tokens ?? [token]) };
    case 'heading':
      return { kind: 'heading', spans: inline((token as Tokens.Heading).tokens) };
    case 'code': {
      const code = token as Tokens.Code;
      return { kind: 'code', text: code.text, lang: code.lang || undefined };
    }
    case 'blockquote':
      return { kind: 'quote', blocks: blocks((token as Tokens.Blockquote).tokens) };
    case 'list': {
      const list = token as Tokens.List;
      return {
        kind: 'list',
        ordered: list.ordered,
        start: typeof list.start === 'number' ? list.start : 1,
        items: list.items.map((item) => blocks(item.tokens)),
      };
    }
    case 'hr':
      return { kind: 'rule' };
    case 'def':
      return null;
    default:
      return { kind: 'paragraph', spans: [{ text: token.raw.replace(/\n+$/, ''), style: {} }] };
  }
}

function inline(tokens: Token[], style: SpanStyle = {}, href?: string): Span[] {
  const spans: Span[] = [];
  const push = (text: string, spanStyle = style, spanHref = href) => {
    if (!text) return;
    const last = spans.at(-1);
    if (last && last.href === spanHref && sameStyle(last.style, spanStyle)) last.text += text;
    else spans.push({ text, style: spanStyle, href: spanHref });
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        spans.push(...inline((token as Tokens.Strong).tokens, { ...style, bold: true }, href));
        break;
      case 'em':
        spans.push(...inline((token as Tokens.Em).tokens, { ...style, italic: true }, href));
        break;
      case 'del':
        spans.push(...inline((token as Tokens.Del).tokens, { ...style, strike: true }, href));
        break;
      case 'codespan':
        push((token as Tokens.Codespan).text, { ...style, code: true });
        break;
      case 'br':
        push('\n');
        break;
      case 'link': {
        const link = token as Tokens.Link;
        if (link.text === link.href || link.href === `mailto:${link.text}`) push(link.text);
        else spans.push(...inline(link.tokens, style, link.href));
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        push(image.text || image.href, style, image.href);
        break;
      }
      case 'text':
        if ('tokens' in token && token.tokens?.length)
          spans.push(...inline(token.tokens, style, href));
        else push(replaceShortcodes((token as Tokens.Text).text));
        break;
      case 'escape':
        push((token as Tokens.Escape).text);
        break;
      default:
        push(token.raw);
    }
  }
  return spans;
}

function sameStyle(a: SpanStyle, b: SpanStyle): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code
  );
}

export function listMarker(list: Extract<Block, { kind: 'list' }>, index: number): string {
  return list.ordered ? `${list.start + index}.` : '•';
}

/** The text a reader sees, with the markup gone: for previews, copying and finding links. */
export function plainText(text: string): string {
  if (!hasMarkup(text)) return hasShortcode(text) ? replaceShortcodes(text) : text;
  return blocksText(parseMarkdown(text));
}

function blocksText(list: Block[]): string {
  return list
    .map((block, i) => (i > 0 ? (block.spaced ? '\n\n' : '\n') : '') + blockText(block))
    .join('');
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
      return block.spans.map((span) => span.text).join('');
    case 'code':
      return block.text;
    case 'quote':
      return blocksText(block.blocks);
    case 'list':
      return block.items.map((item, i) => `${listMarker(block, i)} ${blocksText(item)}`).join('\n');
    case 'rule':
      return '———';
  }
}

/** Links written as `[label](url)`, which reading the plain text alone would miss. */
export function labelledLinks(text: string): string[] {
  if (!hasMarkup(text)) return [];
  const hrefs: string[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.kind === 'paragraph' || block.kind === 'heading') {
        for (const span of block.spans) if (span.href) hrefs.push(span.href);
      } else if (block.kind === 'quote') walk(block.blocks);
      else if (block.kind === 'list') block.items.forEach(walk);
    }
  };
  walk(parseMarkdown(text));
  return hrefs;
}

/** HTML for protocols that carry formatting that way, or null when there is none. */
export function markdownHtml(text: string): string | null {
  if (!hasMarkup(text)) return null;
  const html = (marked.parse(text, { async: false }) as string).trim();
  const plain = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  return html === plain ? null : html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
