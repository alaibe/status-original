import { applyMention } from './use-mention-suggestions';

jest.mock('@/core/messaging/chat-store', () => ({ useChatStore: jest.fn() }));

describe('applyMention', () => {
  it('fills in a handle where the person has one', () => {
    expect(applyMention('hey @bo', { id: '200', name: 'Bob', handle: '@bob' })).toBe('hey @bob ');
  });

  it('links to someone without a handle by name', () => {
    expect(applyMention('hey @ca', { id: '300', name: 'Carol' })).toBe('hey [Carol](mention:300) ');
  });
});
