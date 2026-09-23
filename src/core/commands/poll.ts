import { useChatStore } from '@/core/messaging/chat-store';
import type { SlashCommand } from '@/core/plugins/types';

export const pollCommand: SlashCommand = {
  name: 'poll',
  description: 'Ask a question with choices',
  usage: '/poll "Question" "Choice one" "Choice two"',
  requires: 'createPoll',
  showIn: ['group', 'channel'],
  async run({ args, conversationId }) {
    const [question, ...options] = args.map((value) => value.trim());
    if (!question || options.length < 2 || options.length > 10)
      return { type: 'error', message: 'Use /poll "Question" "Choice one" "Choice two".' };
    if (question.length > 255 || options.some((option) => !option || option.length > 100))
      return {
        type: 'error',
        message: 'Keep the question under 256 characters and each choice under 101.',
      };
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length)
      return { type: 'error', message: 'Each poll choice must be different.' };

    await useChatStore.getState().createPoll(conversationId, question, options);
    return { type: 'handled' };
  },
};
