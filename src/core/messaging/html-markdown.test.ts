import { htmlToMarkdown } from './html-markdown';
import { parseMarkdown, plainText } from './markdown';

describe('htmlToMarkdown', () => {
  it('keeps inline formatting and links', () => {
    expect(
      htmlToMarkdown(
        '<strong>Done</strong> in <a href="https://linear.app/x">Aurem team</a>, <em>really</em> <code>now</code>'
      )
    ).toBe('**Done** in [Aurem team](https://linear.app/x), *really* `now`');
  });

  it('gives each table cell its own lines, as Slack fields read', () => {
    expect(
      htmlToMarkdown(
        '<blockquote><table><tbody><tr><td><strong>Container App:</strong><br>\napi-dag</td>' +
          '<td><strong>Alert State:</strong><br>\nFired</td></tr></tbody></table></blockquote>'
      )
    ).toBe('> **Container App:**\n> api-dag\n>\n> **Alert State:**\n> Fired');
  });

  it('puts each <sup> on its own line', () => {
    expect(
      htmlToMarkdown(
        '<sup><strong>Priority</strong>  High</sup><sup><strong>Project</strong> X</sup>'
      )
    ).toBe('**Priority** High\n\n**Project** X');
  });

  it('writes code blocks, lists, headings and rules', () => {
    expect(
      htmlToMarkdown(
        '<h1>Title</h1><pre><code class="language-ts">let a = 1 &lt; 2;\n</code></pre>' +
          '<ol><li>one</li><li>two</li></ol><hr>'
      )
    ).toBe('# Title\n\n```ts\nlet a = 1 < 2;\n```\n\n1. one\n2. two\n\n---');
  });

  it('drops the quoted reply and turns mentions into names', () => {
    expect(
      htmlToMarkdown(
        '<mx-reply><blockquote>old</blockquote></mx-reply>hi <a href="https://matrix.to/#/@a:b.c">Ann</a>'
      )
    ).toBe('hi Ann');
  });

  it('escapes text that would otherwise read as markup', () => {
    expect(htmlToMarkdown('[INFO] 2*3 my_var <br>- not a list')).toBe(
      '\\[INFO\\] 2\\*3 my_var\n\\- not a list'
    );
  });
});

describe('the parser on what bridges send', () => {
  it('reads consecutive quotes as one', () => {
    expect(parseMarkdown('> a\n\n> ---\n\n> b')).toEqual([
      {
        kind: 'quote',
        blocks: [
          { kind: 'paragraph', spans: [{ text: 'a', style: {} }] },
          { kind: 'rule', spaced: true },
          { kind: 'paragraph', spans: [{ text: 'b', style: {} }], spaced: true },
        ],
      },
    ]);
  });

  it('shows Slack shortcodes as emoji and leaves unknown ones', () => {
    expect(plainText(':information_source: Info :+1: :not_an_emoji:')).toBe(
      'ℹ️ Info 👍 :not_an_emoji:'
    );
    expect(plainText('> :white_check_mark: done')).toBe('\u2705\uFE0F done');
  });

  it('leaves shortcodes inside code alone', () => {
    expect(plainText('`:smile:`')).toBe(':smile:');
  });
});
