import type { TdObject } from './api';
import { formattedToMarkdown, markdownToFormatted } from './formatting';

const entity = (offset: number, length: number, type: string, extra: object = {}): TdObject => ({
  '@type': 'textEntity',
  offset,
  length,
  type: { '@type': type, ...extra },
});

describe('formattedToMarkdown', () => {
  it('leaves unformatted text alone', () => {
    expect(formattedToMarkdown({ text: 'hello there', entities: [] })).toBe('hello there');
  });

  it('writes inline styles, nested ones inside out', () => {
    const text = 'bold and both';
    expect(
      formattedToMarkdown({
        text,
        entities: [entity(0, 13, 'textEntityTypeBold'), entity(9, 4, 'textEntityTypeItalic')],
      })
    ).toBe('**bold and *both***');
  });

  it('keeps whitespace outside the markers so they still parse', () => {
    expect(
      formattedToMarkdown({ text: 'a bold b', entities: [entity(1, 6, 'textEntityTypeBold')] })
    ).toBe('a **bold** b');
  });

  it('writes code, links, code blocks and quotes', () => {
    const text = 'run x now\nsite\nlet a = 1\nsaid so';
    expect(
      formattedToMarkdown({
        text,
        entities: [
          entity(4, 1, 'textEntityTypeCode'),
          entity(10, 4, 'textEntityTypeTextUrl', { url: 'https://a.b/(x)' }),
          entity(15, 9, 'textEntityTypePreCode', { language: 'js' }),
          entity(25, 7, 'textEntityTypeBlockQuote'),
        ],
      })
    ).toBe('run `x` now\n[site](https://a.b/%28x%29)\n```js\nlet a = 1\n```\n> said so');
  });

  it('escapes what would otherwise read as markup', () => {
    expect(formattedToMarkdown({ text: '> 2*3 = 6\n1. no list\nsnake_case', entities: [] })).toBe(
      '\\> 2\\*3 = 6\n1\\. no list\nsnake_case'
    );
  });
});

describe('markdownToFormatted', () => {
  it('sends plain text without entities', () => {
    expect(markdownToFormatted('hi')).toEqual({
      '@type': 'formattedText',
      text: 'hi',
      entities: [],
    });
  });

  it('turns markup into entities over the plain text', () => {
    expect(markdownToFormatted('**hi** [a](https://a.b)\n> q')).toEqual({
      '@type': 'formattedText',
      text: 'hi a\nq',
      entities: [
        entity(0, 2, 'textEntityTypeBold'),
        entity(3, 1, 'textEntityTypeTextUrl', { url: 'https://a.b' }),
        entity(5, 1, 'textEntityTypeBlockQuote'),
      ],
    });
  });

  it('keeps a mention of someone without a username as a link to them', () => {
    const mentioned = {
      '@type': 'formattedText',
      text: 'hi Carol',
      entities: [entity(3, 5, 'textEntityTypeMentionName', { user_id: 300 })],
    };
    expect(formattedToMarkdown(mentioned)).toBe('hi [Carol](mention:300)');
    expect(markdownToFormatted('hi [Carol](mention:300)')).toEqual(mentioned);
  });

  it('round-trips what Telegram sends', () => {
    const original = {
      '@type': 'formattedText',
      text: 'bold, code and 2*3',
      entities: [entity(0, 4, 'textEntityTypeBold'), entity(6, 4, 'textEntityTypeCode')],
    };
    expect(markdownToFormatted(formattedToMarkdown(original))).toEqual(original);
  });
});
