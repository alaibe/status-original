import {
  displayValues,
  fillCommand,
  fillText,
  resolveValues,
  summariseWidget,
  visibleOptions,
  W,
} from './schema';

describe('summariseWidget', () => {
  it('summarises a stat with its label', () => {
    expect(summariseWidget(W.stat('1.5 ETH', { label: 'Balance' }))).toBe('Balance: 1.5 ETH');
  });

  it('joins rows compactly', () => {
    expect(
      summariseWidget(
        W.rows([
          { label: 'Base', value: '0.2 ETH' },
          { label: 'Optimism', value: '0 ETH' },
        ])
      )
    ).toBe('Base: 0.2 ETH · Optimism: 0 ETH');
  });

  it('walks nested cards so a preview is never empty', () => {
    // The chat list shows this text, so every widget must degrade to prose.
    const widget = W.card([W.stat('21000000', { label: 'Supply' }), W.text('Fixed cap')], {
      title: 'Bitcoin',
    });
    expect(summariseWidget(widget)).toBe('Bitcoin · Supply: 21000000 · Fixed cap');
  });

  it('covers every widget kind', () => {
    const kinds = [
      W.stat('1'),
      W.rows([{ label: 'a', value: 'b' }]),
      W.text('t'),
      W.code('0xabc'),
      W.card([]),
      W.badges([{ label: 'live' }]),
      W.actions([{ label: 'Go', command: '/balance' }]),
      W.link('Open', 'https://example.com'),
    ];
    // A missing case would return undefined and render as blank.
    for (const widget of kinds) {
      expect(typeof summariseWidget(widget)).toBe('string');
    }
  });

  it('makes code copyable by default, since identifiers exist to be pasted', () => {
    expect(W.code('bc1q…')).toMatchObject({ copyable: true });
    expect(W.code('bc1q…', { copyable: false })).toMatchObject({ copyable: false });
  });
});

describe('follow-up actions', () => {
  it('keeps commands as strings, so a widget stays serialisable', () => {
    const widget = W.rows([
      {
        label: 'Base',
        value: '1.24 ETH',
        actions: [{ label: 'Send', command: '/draft /send --chain base' }],
      },
    ]);

    // Round-tripping through JSON is what lets a widget be persisted in a
    // transcript and later sent to a peer. A callback could not survive this.
    expect(JSON.parse(JSON.stringify(widget))).toEqual(widget);
  });

  it('summarises a row with actions the same as one without', () => {
    const plain = W.rows([{ label: 'Base', value: '1.24 ETH' }]);
    const actionable = W.rows([
      { label: 'Base', value: '1.24 ETH', actions: [{ label: 'Send', command: '/send' }] },
    ]);
    expect(summariseWidget(actionable)).toBe(summariseWidget(plain));
  });
});

describe('list', () => {
  it('summarises to its titles', () => {
    expect(
      summariseWidget(
        W.list([
          { title: 'Ethereum', subtitle: '12 commands' },
          { title: 'Bots', subtitle: '5 commands' },
        ])
      )
    ).toBe('Ethereum · Bots');
  });

  it('summarises without subtitles', () => {
    // A peer who cannot render the widget needs the names; the subtitle only
    // explains them.
    expect(summariseWidget(W.list([{ title: '/balance' }]))).toBe('/balance');
  });

  it('survives nesting inside a card', () => {
    expect(summariseWidget(W.card([W.list([{ title: '/send' }])], { title: 'Ethereum' }))).toBe(
      'Ethereum · /send'
    );
  });
});

describe('form', () => {
  const form = W.form(
    [
      { id: 'amount', label: 'Amount' },
      { id: 'to', label: 'To' },
    ],
    { label: 'Review', command: '/send {amount} {to}' }
  );

  it('summarises to the button and the fields', () => {
    expect(summariseWidget(form)).toBe('Review · Amount · To');
  });

  it('fills placeholders with what was typed', () => {
    expect(fillCommand('/send {amount} {to}', { amount: '0.01', to: 'vitalik.eth' })).toBe(
      '/send 0.01 vitalik.eth'
    );
  });

  it('quotes a value containing a space', () => {
    // The command parser splits on whitespace, so an unquoted note would
    // arrive as several arguments and the command would read the wrong one.
    expect(fillCommand('/request {amount} {note}', { amount: '5', note: 'two coffees' })).toBe(
      '/request 5 "two coffees"'
    );
  });

  it('leaves an unfilled placeholder empty rather than literal', () => {
    // A stray "{note}" reaching the parser would be read as an argument.
    expect(fillCommand('/request {amount} {note}', { amount: '5' })).toBe('/request 5 ');
  });

  it('trims, so a stray space does not become a quoted argument', () => {
    expect(fillCommand('/send {amount}', { amount: '  0.01  ' })).toBe('/send 0.01');
  });
});

/**
 * Forms whose later questions depend on their earlier ones.
 *
 * The bug being pinned: a payment card asked for an amount "in SOL" before it
 * had asked which chain, so the unit came from whichever chain plugin happened
 * to start first and stayed wrong after the chain chip was changed.
 */
describe('dependent fields', () => {
  const fields = [
    {
      id: 'chain',
      label: 'Chain',
      options: [
        { label: 'Ethereum', value: 'ethereum' },
        { label: 'Bitcoin', value: 'bitcoin' },
      ],
    },
    {
      id: 'token',
      label: 'Token',
      options: [
        { label: 'ETH', value: 'ETH', when: { chain: 'ethereum' } },
        { label: 'BTC', value: 'BTC', when: { chain: 'bitcoin' } },
      ],
    },
    { id: 'amount', label: 'Amount in {token}' },
    { id: 'note', label: 'What for', optional: true },
  ];

  it('offers only the options the current answers allow', () => {
    expect(visibleOptions(fields[1], { chain: 'bitcoin' }).map((o) => o.value)).toEqual(['BTC']);
    expect(visibleOptions(fields[1], { chain: 'ethereum' }).map((o) => o.value)).toEqual(['ETH']);
  });

  it('offers nothing when the field it depends on is unanswered', () => {
    expect(visibleOptions(fields[1], {})).toEqual([]);
  });

  it('leaves a field with no conditions alone', () => {
    expect(visibleOptions(fields[0], {}).map((o) => o.value)).toEqual(['ethereum', 'bitcoin']);
  });

  it('reads a choice by its label, not the value it submits', () => {
    const display = displayValues(fields, { chain: 'bitcoin', token: 'BTC', amount: '0.01' });
    expect(display.chain).toBe('Bitcoin');
    expect(fillText('Amount in {token}', display)).toBe('Amount in BTC');
    expect(fillText('{chain} address', display)).toBe('Bitcoin address');
  });

  it('labels a shared native token value using the selected network', () => {
    const nativeFields = [
      fields[0],
      {
        ...fields[1],
        options: [
          { label: 'ETH', value: 'native', when: { chain: 'ethereum' } },
          { label: 'BTC', value: 'native', when: { chain: 'bitcoin' } },
        ],
      },
    ];
    const bitcoin = displayValues(nativeFields, { chain: 'bitcoin', token: 'native' });
    expect(fillText('Amount in {token}', bitcoin)).toBe('Amount in BTC');
    const ethereum = displayValues(nativeFields, { chain: 'ethereum', token: 'native' });
    expect(fillText('Amount in {token}', ethereum)).toBe('Amount in ETH');
  });

  it('keeps a placeholder nobody filled in rather than blanking it', () => {
    expect(fillText('Amount in {token}', displayValues(fields, {}))).toBe('Amount in {token}');
  });

  it('still submits the value, not the label', () => {
    expect(
      fillCommand('/send {amount} --chain {chain}', { amount: '0.01', chain: 'bitcoin' })
    ).toBe('/send 0.01 --chain bitcoin');
  });

  it('moves a stale choice onto the chain that is now selected', () => {
    const answers = resolveValues(fields, { chain: 'bitcoin', token: 'ETH', amount: '0.01' });
    expect(answers.token).toBe('BTC');
    // Everything else is left exactly as typed.
    expect(answers.amount).toBe('0.01');
  });

  it('fills in a choice nobody has made yet', () => {
    expect(resolveValues(fields, { chain: 'ethereum' }).token).toBe('ETH');
  });

  it('leaves a choice alone when it is still on offer', () => {
    const values = { chain: 'ethereum', token: 'ETH' };
    expect(resolveValues(fields, values)).toBe(values);
  });
});

/**
 * What the end of a tappable row promises: say what the tap does. A chevron
 * points off-screen and so promises a destination, but a row with one action
 * runs it on the spot and a row with several opens a sheet, and neither is
 * anywhere to go; an ellipsis reads as "opens something" for the same reason.
 * So the row shows an icon only when the action asked for one (a switch
 * beside a name that already has a state dot) and words otherwise, because
 * "Send ETH" beside a balance is a sentence and a glyph there would be a guess.
 */
function affordanceFor(actions: { label: string; icon?: string }[] | undefined) {
  if (!actions?.length) return null;
  const primary = actions[0];
  if (primary.icon) return { kind: 'icon' as const, icon: primary.icon, label: primary.label };
  return { kind: 'text' as const, label: actions.length === 1 ? primary.label : 'Options' };
}

describe('what a row says a tap will do', () => {
  it('says nothing when nothing happens', () => {
    expect(affordanceFor(undefined)).toBeNull();
    expect(affordanceFor([])).toBeNull();
  });

  it('names the single action, so the row reads as a sentence', () => {
    expect(affordanceFor([{ label: 'Send ETH' }])).toEqual({ kind: 'text', label: 'Send ETH' });
  });

  /**
   * Destructive actions included. The tap opens a confirming sheet rather than
   * removing anything, so "Remove" is an honest description of what it starts.
   * Behind a neutral glyph it would be a row that removes someone without
   * saying so.
   */
  it('names a destructive action too', () => {
    expect(affordanceFor([{ label: 'Remove from group' }])).toEqual({
      kind: 'text',
      label: 'Remove from group',
    });
  });

  it('uses a glyph only when the action supplied one, and keeps its words', () => {
    expect(affordanceFor([{ label: 'Turn Bots off', icon: 'power' }])).toEqual({
      kind: 'icon',
      icon: 'power',
      // Still required: it is the accessibility label, and the sheet's button.
      label: 'Turn Bots off',
    });
  });

  /**
   * With several actions the row shows the first one's glyph. A tap opens a
   * sheet with all of them, so the glyph is not a promise that one tap does
   * it, only a hint of which one leads, which a bare "…" cannot give.
   */
  it('shows the primary action when several carry icons', () => {
    expect(
      affordanceFor([
        { label: 'Make Base the default', icon: 'star-outline' },
        { label: 'Switch Base off', icon: 'power' },
      ])
    ).toEqual({ kind: 'icon', icon: 'star-outline', label: 'Make Base the default' });
  });

  /**
   * Never a glyph nobody asked for. A generic "…" would look like a
   * destination, and a sheet of the actions the row already has is not one.
   */
  it('promises only options when several actions have no icon', () => {
    expect(affordanceFor([{ label: 'Open' }, { label: 'Switch off' }])).toEqual({
      kind: 'text',
      label: 'Options',
    });
  });
});
