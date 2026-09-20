import {
  commandNamePrefix,
  completeCommandName,
  isTypingCommandName,
  parseCommand,
  tokenize,
} from './parser';

describe('parseCommand', () => {
  it('returns null for plain text', () => {
    expect(parseCommand('hello there')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('parses a bare command', () => {
    expect(parseCommand('/balance')).toEqual({ name: 'balance', rest: '', args: [] });
  });

  it('lowercases the name but preserves argument case', () => {
    expect(parseCommand('/Send 0.1 0xAbCd')).toEqual({
      name: 'send',
      rest: '0.1 0xAbCd',
      args: ['0.1', '0xAbCd'],
    });
  });

  it('keeps quoted arguments together', () => {
    expect(tokenize('add "my main wallet" 0x1')).toEqual(['add', 'my main wallet', '0x1']);
  });
});

describe('autocomplete helpers', () => {
  it('detects an in-progress command name', () => {
    expect(isTypingCommandName('/')).toBe(true);
    expect(isTypingCommandName('/se')).toBe(true);
    expect(isTypingCommandName('/send ')).toBe(false);
    expect(isTypingCommandName('hi')).toBe(false);
  });

  it('extracts the prefix being typed', () => {
    expect(commandNamePrefix('/sen')).toBe('sen');
    expect(commandNamePrefix('hello')).toBe('');
  });
});

describe('completeCommandName', () => {
  const NAMES = ['balance', 'send', 'watch', 'watched', 'whoami'];

  it('finishes a name that only one command can be', () => {
    // With a trailing space, because the next thing you type is an argument.
    expect(completeCommandName('/bal', NAMES)).toBe('/balance ');
  });

  it('stops at what the candidates agree on', () => {
    // `/w` matches watch, watched and whoami; only "w" is shared, so there is
    // nothing to add and guessing one of them would be worse than waiting.
    expect(completeCommandName('/w', NAMES)).toBeNull();
    // `/wat` narrows to watch and watched, which agree as far as "watch".
    expect(completeCommandName('/wat', NAMES)).toBe('/watch');
  });

  it('leaves the input alone when there is nothing to add', () => {
    expect(completeCommandName('/watch', ['watch', 'watched'])).toBeNull();
    expect(completeCommandName('/zzz', NAMES)).toBeNull();
  });

  it('ignores anything that is not a command name being typed', () => {
    expect(completeCommandName('hello', NAMES)).toBeNull();
    expect(completeCommandName('/send 0.1', NAMES)).toBeNull();
  });

  it('matches case-insensitively, and answers in the canonical case', () => {
    expect(completeCommandName('/BAL', NAMES)).toBe('/balance ');
  });
});
