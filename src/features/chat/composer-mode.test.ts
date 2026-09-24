import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage } from '@/core/messaging/types';

import { type ComposerMode, ComposerModeController } from './composer-mode';

const message = (id: string, text: string): ChatMessage => ({
  id,
  conversationId: 'c1',
  senderId: 'me',
  sentAt: 1,
  content: { kind: 'text', text },
  fromMe: true,
  status: 'sent',
});

function harness(start: ComposerMode = { kind: 'compose' }, thread?: string) {
  let mode = start;
  const onSend = jest.fn();
  const controller = () =>
    new ComposerModeController('c1', mode, (next) => (mode = next), onSend, thread);
  return { controller, mode: () => mode, onSend };
}

const setDraft = jest.fn();
const sendMessage = jest.fn(async () => ({ sent: true as const }));
const editMessage = jest.fn(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({
    drafts: { c1: 'half typed', 'c1#thread:root': 'thread draft' },
    setDraft,
    sendMessage,
    editMessage,
  });
});

describe('ComposerModeController', () => {
  it('puts the message in the box to edit, and the draft back on cancel', () => {
    const h = harness();
    h.controller().edit(message('m1', 'old words'));
    expect(setDraft).toHaveBeenLastCalledWith('c1', 'old words', undefined);
    expect(h.mode()).toMatchObject({ kind: 'edit', savedDraft: 'half typed' });

    h.controller().cancel();
    expect(setDraft).toHaveBeenLastCalledWith('c1', 'half typed', undefined);
    expect(h.mode()).toEqual({ kind: 'compose' });
  });

  it('edits instead of sending, and hands back the saved draft', async () => {
    const h = harness({ kind: 'edit', target: message('m1', 'old'), savedDraft: 'half typed' });
    expect(await h.controller().submit('new')).toBe('half typed');
    expect(editMessage).toHaveBeenCalledWith('c1', 'm1', 'new');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(h.onSend).not.toHaveBeenCalled();
  });

  it('sends a reply to its target, then goes back to composing', async () => {
    const h = harness({ kind: 'reply', target: message('m2', 'question') });
    expect(await h.controller().submit('answer')).toBe('');
    expect(sendMessage).toHaveBeenCalledWith(
      'c1',
      { kind: 'text', text: 'answer' },
      'm2',
      undefined
    );
    expect(h.onSend).toHaveBeenCalled();
    expect(h.mode()).toEqual({ kind: 'compose' });
  });

  it('keeps a thread’s draft apart from the chat’s and sends into the thread', async () => {
    const h = harness({ kind: 'compose' }, 'root');
    h.controller().edit(message('m1', 'old words'));
    expect(setDraft).toHaveBeenLastCalledWith('c1', 'old words', 'root');
    expect(h.mode()).toMatchObject({ savedDraft: 'thread draft' });

    h.controller().cancel();
    await h.controller().submit('in the thread');
    expect(sendMessage).toHaveBeenCalledWith(
      'c1',
      { kind: 'text', text: 'in the thread' },
      undefined,
      'root'
    );
  });

  it('describes the mode for the banner above the box', () => {
    const describe = () => ({ author: 'Ann', preview: 'question' });
    expect(harness().controller().banner(describe)).toBeNull();
    expect(
      harness({ kind: 'reply', target: message('m2', 'q') })
        .controller()
        .banner(describe)
    ).toEqual({ label: 'Ann', detail: 'question' });
  });
});
