import { parseArgs } from './args';
import { COMMANDS } from './commands';
import { CliError } from './errors';

describe('parseArgs', () => {
  it('picks the longest command path', () => {
    expect(parseArgs(['group', 'members', 'x']).spec.path).toBe('group members');
    expect(parseArgs(['accounts']).spec.path).toBe('accounts');
  });

  it('joins a trailing variadic argument and keeps its words', () => {
    const parsed = parseArgs(['send', 'alice', 'on', 'my', 'way']);
    expect(parsed.args).toEqual({ chat: 'alice', text: 'on my way' });
    expect(parsed.rest).toEqual(['on', 'my', 'way']);
  });

  it('takes flag values inline or as the next word', () => {
    expect(parseArgs(['read', 'a', '--limit', '5']).flags.limit).toBe('5');
    expect(parseArgs(['read', 'a', '--limit=5']).flags.limit).toBe('5');
    expect(parseArgs(['read', 'a', '--mark-read', '--json']).flags).toEqual({
      'mark-read': true,
      json: true,
    });
  });

  it('fills an optional argument only when there are words to spare', () => {
    expect(parseArgs(['run', '/balance']).args).toEqual({ chat: undefined, command: '/balance' });
    expect(parseArgs(['run', 'alice', '/send', '1']).args).toEqual({
      chat: 'alice',
      command: '/send 1',
    });
  });

  it('passes a slash command’s own options through', () => {
    expect(parseArgs(['run', 'alice', '/send', '1', '--confirm']).rest).toEqual([
      '/send',
      '1',
      '--confirm',
    ]);
  });

  it('treats everything after -- as text', () => {
    expect(parseArgs(['send', 'a', '--', '--not-a-flag']).args.text).toBe('--not-a-flag');
  });

  it('explains what is wrong', () => {
    expect(() => parseArgs(['send'])).toThrow('Missing <chat>');
    expect(() => parseArgs(['read', 'a', '--nope'])).toThrow('Unknown option --nope');
    expect(() => parseArgs(['mark-read', 'a', 'b'])).toThrow('Unexpected "b"');
    expect(() => parseArgs(['frobnicate'])).toThrow(CliError);
  });

  it('never lets two commands share a path', () => {
    const paths = COMMANDS.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
