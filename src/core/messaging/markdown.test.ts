import { labelledLinks, markdownHtml, parseMarkdown, plainText } from './markdown';

describe('parseMarkdown', () => {
  it('leaves plain text as one unstyled paragraph', () => {
    expect(parseMarkdown('see you at 5, ok?')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'see you at 5, ok?', style: {} }] },
    ]);
  });

  it('styles inline spans, including right after a code span and a line break', () => {
    const [block] = parseMarkdown('**Status:** ok `x<y`\n_it_ ~~no~~ [site](https://a.b)');
    expect(block).toEqual({
      kind: 'paragraph',
      spans: [
        { text: 'Status:', style: { bold: true } },
        { text: ' ok ', style: {} },
        { text: 'x<y', style: { code: true } },
        { text: '\n', style: {} },
        { text: 'it', style: { italic: true } },
        { text: ' ', style: {} },
        { text: 'no', style: { strike: true } },
        { text: ' ', style: {} },
        { text: 'site', style: {}, href: 'https://a.b' },
      ],
    });
  });

  it('keeps bare URLs as text for link detection to find', () => {
    const [block] = parseMarkdown('**see** https://example.com');
    expect(block).toMatchObject({ spans: [{ text: 'see' }, { text: ' https://example.com' }] });
  });

  it('reads quotes, fenced code and lists', () => {
    expect(parseMarkdown('> quoted\n\n```js\nlet a = 1;\n```\n- one\n- two')).toEqual([
      { kind: 'quote', blocks: [{ kind: 'paragraph', spans: [{ text: 'quoted', style: {} }] }] },
      { kind: 'code', text: 'let a = 1;', lang: 'js', spaced: true },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          [{ kind: 'paragraph', spans: [{ text: 'one', style: {} }] }],
          [{ kind: 'paragraph', spans: [{ text: 'two', style: {} }] }],
        ],
      },
    ]);
  });

  it('treats indentation and underlined lines as prose, not code or headings', () => {
    expect(parseMarkdown('    indented *x*')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: '    indented ', style: {} },
          { text: 'x', style: { italic: true } },
        ],
      },
    ]);
    expect(parseMarkdown('title\n---').map((b) => b.kind)).not.toContain('heading');
  });

  it('does not italicise inside snake_case words', () => {
    expect(plainText('use my_var_name here')).toBe('use my_var_name here');
  });
});

describe('plainText', () => {
  it('drops the markup a reader never sees', () => {
    expect(plainText('> **Status:** `ok`\n\n- [a](https://a.b)\n- \\*b\\*')).toBe(
      'Status: ok\n\n• a\n• *b*'
    );
  });
});

describe('labelledLinks', () => {
  it('finds the targets of written links, not bare ones', () => {
    expect(labelledLinks('[run](https://ci/1) and https://bare.dev')).toEqual(['https://ci/1']);
  });
});

describe('markdownHtml', () => {
  it('is null when nothing is formatted', () => {
    expect(markdownHtml('hello there')).toBeNull();
    expect(markdownHtml('snake_case & more')).toBeNull();
  });

  it('renders formatting and escapes HTML the sender typed', () => {
    expect(markdownHtml('**hi** <b>x</b>')).toBe('<p><strong>hi</strong> &lt;b&gt;x&lt;/b&gt;</p>');
  });
});
