import { buttonCommand } from './button';

it('tells button contracts from commands', () => {
  expect(buttonCommand('/draft /send 5 ')).toEqual({ kind: 'draft', text: '/send 5 ' });
  expect(buttonCommand('/reply yes please')).toEqual({ kind: 'reply', text: 'yes please' });
  expect(buttonCommand(' /balance ')).toEqual({ kind: 'command', text: '/balance' });
});
