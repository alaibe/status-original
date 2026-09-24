import { COMMANDS } from './commands';
import * as coverage from './coverage';
import { HANDLERS } from './handlers';

const paths = new Set<string>(COMMANDS.map((c) => c.path));

describe.each(Object.entries(coverage))('%s', (_, map) => {
  it.each(Object.entries(map))('%s has a command or a reason', (_action, where) => {
    expect(paths.has(where) || where === 'internal' || /^app: \S/.test(where)).toBe(true);
  });
});

it('has a handler for every command but the one the app answers itself', () => {
  expect(Object.keys(HANDLERS).sort()).toEqual([...paths].filter((p) => p !== 'quit').sort());
});
