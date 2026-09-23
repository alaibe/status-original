import type { ChatMessage } from '@/core/messaging/types';

import { messageActions } from './message-commands';

const handlers = {
  reply: jest.fn(),
  forward: jest.fn(),
  edit: jest.fn(),
  remove: jest.fn(),
  retry: jest.fn(),
  togglePin: jest.fn(),
};
const all = { edit: true, delete: true, deleteForMe: true, deleteOthers: false, pin: true };
const none = { edit: false, delete: false, deleteForMe: false, deleteOthers: false, pin: false };

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'c1',
  senderId: 'me',
  sentAt: 1,
  content: { kind: 'text', text: 'hello' },
  fromMe: true,
  status: 'sent',
  ...over,
});

const ids = (m: ChatMessage, can = all) => messageActions(m, handlers, can).map((a) => a.id);

describe('messageActions', () => {
  it('offers everything for my own sent text where the network can do it', () => {
    expect(ids(message())).toEqual([
      'reply',
      'copy',
      'forward',
      'edit',
      'pin',
      'delete-for-me',
      'delete',
    ]);
  });

  it('leaves out what the network cannot do', () => {
    expect(ids(message(), none)).toEqual(['reply', 'copy', 'forward']);
  });

  it('never edits someone else’s message, and deletes it for everyone only with the right', () => {
    expect(ids(message({ fromMe: false }))).toEqual([
      'reply',
      'copy',
      'forward',
      'pin',
      'delete-for-me',
    ]);
    expect(ids(message({ fromMe: false }), { ...all, deleteOthers: true })).toContain('delete');
  });

  it('hides pinning where the chat does not allow it', () => {
    expect(ids(message(), { ...all, pin: false })).not.toContain('pin');
  });

  it('offers a retry for a failed send, and nothing that needs it to have arrived', () => {
    expect(ids(message({ status: 'failed' }))).toEqual(['retry', 'reply', 'copy', 'forward']);
  });

  it('hands the message to the flow it starts', () => {
    const m = message();
    messageActions(m, handlers, all)
      .find((a) => a.id === 'edit')
      ?.onPress();
    expect(handlers.edit).toHaveBeenCalledWith(m);
  });
});
