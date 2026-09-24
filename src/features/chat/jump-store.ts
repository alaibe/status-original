import { create } from 'zustand';

import type { ChatMessage, MessageId } from '@/core/messaging/types';

type JumpTarget = Pick<ChatMessage, 'conversationId' | 'id' | 'sentAt'>;

interface JumpState {
  /** A message the conversation screen should scroll to once it has it loaded. */
  target: JumpTarget | null;
  /** The message it scrolled to, highlighted for a moment. */
  landed: MessageId | null;
  jumpTo(message: JumpTarget): void;
  land(id: MessageId | null): void;
}

export const useJumpStore = create<JumpState>((set) => ({
  target: null,
  landed: null,
  jumpTo: ({ conversationId, id, sentAt }) => set({ target: { conversationId, id, sentAt } }),
  land: (landed) => set({ target: null, landed }),
}));
