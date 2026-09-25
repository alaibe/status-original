import { useMemo, useState } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import { draftKey } from '@/core/messaging/drafts';
import type { ChatMessage, ConversationId, MessageId } from '@/core/messaging/types';

import type { ReplyPreview } from './message-bubble';

export type ComposerMode =
  | { kind: 'compose' }
  | { kind: 'reply'; target: ChatMessage }
  | { kind: 'edit'; target: ChatMessage; savedDraft: string };

export interface ComposerBanner {
  label: string;
  detail?: string;
}

const COMPOSE: ComposerMode = { kind: 'compose' };

export class ComposerModeController {
  constructor(
    private readonly id: ConversationId,
    readonly mode: ComposerMode,
    private readonly enter: (mode: ComposerMode) => void,
    private readonly onSend?: () => void,
    private readonly thread?: MessageId
  ) {}

  reply(target: ChatMessage) {
    this.restoreDraft();
    this.enter({ kind: 'reply', target });
  }

  edit(target: ChatMessage) {
    if (target.content.kind !== 'text') return;
    const { drafts, setDraft } = useChatStore.getState();
    const savedDraft =
      this.mode.kind === 'edit'
        ? this.mode.savedDraft
        : (drafts[draftKey(this.id, this.thread)] ?? '');
    setDraft(this.id, target.content.text, this.thread);
    this.enter({ kind: 'edit', target, savedDraft });
  }

  cancel() {
    this.restoreDraft();
    this.enter(COMPOSE);
  }

  /** Sends the text as the mode means it, and returns what the box should hold after. */
  async submit(text: string): Promise<string> {
    const chat = useChatStore.getState();
    const mode = this.mode;
    if (mode.kind === 'edit') {
      await chat.editMessage(this.id, mode.target.id, text);
      this.enter(COMPOSE);
      return mode.savedDraft;
    }
    this.onSend?.();
    await chat.sendMessage(
      this.id,
      { kind: 'text', text },
      mode.kind === 'reply' ? mode.target.id : undefined,
      this.thread
    );
    this.enter(COMPOSE);
    return '';
  }

  banner(describe: (message: ChatMessage) => ReplyPreview): ComposerBanner | null {
    if (this.mode.kind === 'edit') return { label: 'Editing message' };
    if (this.mode.kind === 'compose') return null;
    const { author, preview } = describe(this.mode.target);
    return { label: author, detail: preview };
  }

  private restoreDraft() {
    if (this.mode.kind === 'edit')
      useChatStore.getState().setDraft(this.id, this.mode.savedDraft, this.thread);
  }
}

/** The composer's mode for one chat or thread; opening another starts it fresh. */
export function useComposerMode(id: ConversationId, onSend?: () => void, thread?: MessageId) {
  const key = draftKey(id, thread);
  const [state, setState] = useState({ key, mode: COMPOSE });
  const mode = state.key === key ? state.mode : COMPOSE;
  return useMemo(
    () =>
      new ComposerModeController(id, mode, (next) => setState({ key, mode: next }), onSend, thread),
    [id, mode, key, onSend, thread]
  );
}
