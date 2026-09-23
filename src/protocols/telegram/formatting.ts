import { type Block, hasMarkup, listMarker, parseMarkdown } from '@/core/messaging/markdown';

import type { TdObject } from './api';
import type { TdFormattedText } from './types';

interface Entity {
  offset: number;
  length: number;
  type: TdObject;
}

interface Mark {
  at: number;
  open: boolean;
  /** Orders marks at one position: outer opens first, inner closes first. */
  rank: number;
  text: string;
  verbatim?: boolean;
  quote?: boolean;
}

const INLINE: Record<string, string> = {
  textEntityTypeBold: '**',
  textEntityTypeItalic: '*',
  textEntityTypeStrikethrough: '~~',
};

/** TDLib's entities as the Markdown the rest of the app reads. */
export function formattedToMarkdown(formatted: { text: string; entities?: TdObject[] }): string {
  const { text } = formatted;
  const entities = (formatted.entities ?? []) as unknown as Entity[];
  const marks: Mark[] = [];
  const pair = (start: number, end: number, open: string, close: string, extra?: Partial<Mark>) => {
    marks.push({ at: start, open: true, rank: -end, text: open, ...extra });
    marks.push({ at: end, open: false, rank: -start, text: close, ...extra });
  };

  for (const { offset, length, type } of entities) {
    let start = offset;
    let end = offset + length;
    const kind = type['@type'] as string;

    if (kind === 'textEntityTypePre' || kind === 'textEntityTypePreCode') {
      const before = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
      const after = end < text.length && text[end] !== '\n' ? '\n' : '';
      const language = (type.language as string | undefined) ?? '';
      pair(start, end, `${before}\`\`\`${language}\n`, `\n\`\`\`${after}`, { verbatim: true });
      continue;
    }
    if (kind === 'textEntityTypeBlockQuote' || kind === 'textEntityTypeExpandableBlockQuote') {
      const before = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
      const after = end >= text.length ? '' : text[end] === '\n' ? '\n' : '\n\n';
      pair(start, end, before, after, { quote: true });
      continue;
    }

    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start === end) continue;

    if (kind === 'textEntityTypeCode') {
      const fence = text.slice(start, end).includes('`') ? '`` ' : '`';
      pair(start, end, fence, [...fence].reverse().join(''), { verbatim: true });
    } else if (kind === 'textEntityTypeTextUrl') {
      pair(start, end, '[', `](${encodeUrl(type.url as string)})`);
    } else if (INLINE[kind]) {
      pair(start, end, INLINE[kind], INLINE[kind]);
    }
  }

  marks.sort((a, b) => a.at - b.at || Number(a.open) - Number(b.open) || a.rank - b.rank);

  let out = '';
  let verbatim = 0;
  let quote = 0;
  let next = 0;
  let escapeAt = -1;
  const atLineStart = () => out === '' || out.endsWith('\n');

  for (let i = 0; i <= text.length; i++) {
    for (; next < marks.length && marks[next].at === i; next++) {
      const mark = marks[next];
      if (mark.quote) {
        out += mark.text;
        quote += mark.open ? 1 : -1;
        if (mark.open) out += '> ';
        continue;
      }
      out += mark.text;
      if (mark.verbatim) verbatim += mark.open ? 1 : -1;
      if (quote > 0 && mark.open && mark.verbatim && out.endsWith('\n')) out += '> ';
    }
    if (i === text.length) break;

    const char = text[i];
    if (verbatim > 0) {
      out += char;
    } else {
      if (atLineStart() || (quote > 0 && out.endsWith('> '))) {
        const list = /^(\d+)[.)]\s/.exec(text.slice(i));
        if (list) escapeAt = i + list[1].length;
      }
      out += escapeChar(text, i, atLineStart()) || (i === escapeAt ? `\\${char}` : char);
    }
    if (char === '\n' && quote > 0) out += '> ';
  }
  return out;
}

function escapeChar(text: string, i: number, lineStart: boolean): string {
  const char = text[i];
  const prev = text[i - 1] ?? '';
  const after = text[i + 1] ?? '';
  const word = (c: string) => /[\p{L}\p{N}]/u.test(c);

  if ('\\*`[]'.includes(char)) return `\\${char}`;
  if (char === '_' && !(word(prev) && word(after))) return '\\_';
  if (char === '~' && prev !== '/') return '\\~';
  if (lineStart && (char === '>' || char === '#')) return `\\${char}`;
  if (lineStart && (char === '-' || char === '+') && after === ' ') return `\\${char}`;
  return '';
}

function encodeUrl(url: string): string {
  return url.replace(
    /[()\s]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

/** The Markdown the app writes, as the text and entities TDLib sends. */
export function markdownToFormatted(markdown: string): TdFormattedText {
  if (!hasMarkup(markdown)) return { '@type': 'formattedText', text: markdown, entities: [] };

  let text = '';
  const entities: TdObject[] = [];
  const entity = (start: number, type: TdObject) => {
    if (text.length > start) {
      entities.push({ '@type': 'textEntity', offset: start, length: text.length - start, type });
    }
  };

  const write = (list: Block[]) => {
    list.forEach((block, i) => {
      if (i > 0) text += block.spaced ? '\n\n' : '\n';
      const start = text.length;
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
          for (const span of block.spans) {
            const from = text.length;
            text += span.text;
            if (span.style.bold) entity(from, { '@type': 'textEntityTypeBold' });
            if (span.style.italic) entity(from, { '@type': 'textEntityTypeItalic' });
            if (span.style.strike) entity(from, { '@type': 'textEntityTypeStrikethrough' });
            if (span.style.code) entity(from, { '@type': 'textEntityTypeCode' });
            if (span.href) entity(from, { '@type': 'textEntityTypeTextUrl', url: span.href });
          }
          if (block.kind === 'heading') entity(start, { '@type': 'textEntityTypeBold' });
          break;
        case 'code':
          text += block.text;
          entity(
            start,
            block.lang
              ? { '@type': 'textEntityTypePreCode', language: block.lang }
              : { '@type': 'textEntityTypePre' }
          );
          break;
        case 'quote':
          write(block.blocks);
          entity(start, { '@type': 'textEntityTypeBlockQuote' });
          break;
        case 'list':
          block.items.forEach((item, n) => {
            if (n > 0) text += '\n';
            text += `${listMarker(block, n)} `;
            write(item);
          });
          break;
        case 'rule':
          text += '———';
          break;
      }
    });
  };

  write(parseMarkdown(markdown));
  return { '@type': 'formattedText', text, entities };
}
