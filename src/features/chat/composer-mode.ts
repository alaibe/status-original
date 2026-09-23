import { useState } from 'react';

import { useChatStore } from '@/core/messaging/chat-store';
import type { ChatMessage, ConversationId } from '@/core/messaging/types';

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
    private readonly onSend?: () => void
  ) {}

  reply(target: ChatMessage) {
    this.restoreDraft();
    this.enter({ kind: 'reply', target });
  }

  edit(target: ChatMessage) {
    if (target.content.kind !== 'text') return;
    const { drafts, setDraft } = useChatStore.getState();
    const savedDraft = this.mode.kind === 'edit' ? this.mode.savedDraft : (drafts[this.id] ?? '');
    setDraft(this.id, target.content.text);
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
      mode.kind === 'reply' ? mode.target.id : undefined
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
    if (this.mode.kind === 'edit') useChatStore.getState().setDraft(this.id, this.mode.savedDraft);
  }
}

/** The composer's mode for one chat; opening another chat starts it fresh. */
export function useComposerMode(id: ConversationId, onSend?: () => void) {
  const [state, setState] = useState({ id, mode: COMPOSE });
  const mode = state.id === id ? state.mode : COMPOSE;
  return new ComposerModeController(id, mode, (next) => setState({ id, mode: next }), onSend);
}
