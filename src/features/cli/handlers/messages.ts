import { fallbackMimeType } from '@/core/messaging/attachments';
import { sessionFor, useChatStore, type SendOutcome } from '@/core/messaging/chat-store';
import { readMediaBase64 } from '@/core/messaging/media-store';
import type { ConversationId, MessageContent } from '@/core/messaging/types';
import { errorMessage } from '@/core/errors';
import { base64ToBytes } from '@/lib/bytes';
import { contentFromBrowserFile } from '@/features/chat/attachments/pick';

import {
  displayNames,
  findChat,
  findMessage,
  messageJson,
  messageLine,
  readyChat,
  readyMessage,
  type CliHandler,
  type CliIo,
} from '../context';
import { CliError } from '../errors';
import { basename, readFileArg, stdinText } from './input';

async function attachment(
  io: CliIo,
  chatId: ConversationId,
  path: string,
  name: string | undefined
): Promise<MessageContent> {
  const filename = name ?? (path === '-' ? 'file' : basename(path));
  const bytes = await readFileArg(io, path);
  const file = new File([bytes as BlobPart], filename, { type: fallbackMimeType(filename) });
  const sendsVideo = Boolean(sessionFor(useChatStore.getState(), chatId)?.sendsVideo);
  return contentFromBrowserFile(file, sendsVideo);
}

function sent(chatId: ConversationId, outcome: SendOutcome | null): void {
  if (outcome && !outcome.sent) {
    throw new CliError(
      `${errorMessage(outcome.error, 'Sending failed')}. Try again with: status-original retry ${chatId} ${outcome.messageId}`
    );
  }
}

async function deliver(chatId: ConversationId, content: MessageContent, replyTo?: string) {
  sent(chatId, await useChatStore.getState().sendMessage(chatId, content, replyTo));
}

export const messageHandlers = {
  async send({ args, flags }, { io }) {
    const chat = await readyChat(args.chat!);
    const reply =
      typeof flags.reply === 'string' ? await findMessage(chat.id, flags.reply) : undefined;
    const file = typeof flags.file === 'string' ? flags.file : undefined;
    const text =
      args.text !== undefined && args.text !== '-'
        ? args.text
        : file === '-'
          ? undefined
          : (await stdinText(io))?.replace(/\n$/, '');
    if (!file && !text?.trim()) {
      throw new CliError('Nothing to send. Give the text, or pipe it in.', 'usage');
    }

    if (file)
      await deliver(
        chat.id,
        await attachment(io, chat.id, file, flags.name as string | undefined),
        reply?.id
      );
    if (text?.trim()) await deliver(chat.id, { kind: 'text', text }, file ? undefined : reply?.id);
    return { data: { chat: chat.id, sent: true }, text: `Sent to ${chat.label}.` };
  },

  async edit({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    if (!message.fromMe) throw new CliError('You can only edit your own messages.', 'usage');
    await useChatStore.getState().editMessage(chat.id, message.id, args.text!);
    return { data: { chat: chat.id, id: message.id, edited: true }, text: 'Edited.' };
  },

  async delete({ args, flags }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    const forEveryone = !flags['for-me'];
    await useChatStore.getState().deleteMessage(chat.id, message.id, forEveryone);
    return {
      data: { chat: chat.id, id: message.id, deleted: forEveryone ? 'everyone' : 'me' },
      text: forEveryone ? 'Deleted for everyone.' : 'Deleted for you.',
    };
  },

  async react({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    await useChatStore.getState().react(chat.id, message.id, args.emoji!);
    return {
      data: { chat: chat.id, id: message.id, emoji: args.emoji },
      text: `Reacted ${args.emoji}.`,
    };
  },

  async forward({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    const to = await findChat(args.to!);
    await deliver(to.id, message.content);
    return {
      data: { from: chat.id, id: message.id, to: to.id },
      text: `Forwarded to ${to.label}.`,
    };
  },

  async retry({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    if (message.status !== 'failed') throw new CliError('That message did not fail.', 'usage');
    sent(chat.id, await useChatStore.getState().retryMessage(chat.id, message.id));
    return { data: { chat: chat.id, id: message.id, sent: true }, text: 'Sent.' };
  },

  async pins({ args }) {
    const chat = await readyChat(args.chat!);
    const pinned = await useChatStore.getState().listPinnedMessages(chat.id);
    const names = await displayNames(
      chat.protocol,
      pinned.map((m) => m.senderId)
    );
    return {
      data: pinned.map((m) => messageJson(m, names)),
      text: pinned.length ? pinned.map((m) => messageLine(m, names)) : 'Nothing pinned.',
    };
  },

  async 'pin-message'({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    await useChatStore.getState().setMessagePinned(chat.id, message.id, true);
    return { data: { chat: chat.id, id: message.id, pinned: true }, text: 'Pinned.' };
  },

  async 'unpin-message'({ args }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    await useChatStore.getState().setMessagePinned(chat.id, message.id, false);
    return { data: { chat: chat.id, id: message.id, pinned: false }, text: 'Unpinned.' };
  },

  async 'poll create'({ args, rest }) {
    const chat = await readyChat(args.chat!);
    const options = rest;
    if (options.length < 2) throw new CliError('A poll needs at least two options.', 'usage');
    await useChatStore.getState().createPoll(chat.id, args.question!, options);
    return { data: { chat: chat.id, question: args.question, options }, text: 'Poll posted.' };
  },

  async 'poll vote'({ args, rest }) {
    const { chat, message } = await readyMessage(args.chat!, args.message!);
    if (message.content.kind !== 'poll') throw new CliError('That message is not a poll.', 'usage');
    const count = message.content.options.length;
    const chosen = rest.map((n) => Number(n));
    if (chosen.some((n) => !Number.isInteger(n) || n < 1 || n > count)) {
      throw new CliError(`Options are numbered 1 to ${count}.`, 'usage');
    }
    await useChatStore.getState().votePoll(
      chat.id,
      message.id,
      chosen.map((n) => n - 1)
    );
    return { data: { chat: chat.id, id: message.id, options: chosen }, text: 'Voted.' };
  },

  async download({ args, flags }, { io }) {
    const { message } = await readyMessage(args.chat!, args.message!);
    const c = message.content;
    if (c.kind !== 'image' && c.kind !== 'file' && c.kind !== 'voice' && c.kind !== 'video') {
      throw new CliError('That message has no attachment.', 'usage');
    }
    const out =
      typeof flags.out === 'string'
        ? flags.out
        : (c.name ?? `${message.id}.${c.mimeType?.split('/')[1] ?? 'bin'}`);
    const { data, size } = await readMediaBase64(c.uri);
    await io.writeFile(out, base64ToBytes(data));
    return {
      data: { path: out, size, mimeType: c.mimeType },
      text: `Saved ${out} (${size} bytes).`,
    };
  },
} satisfies Record<string, CliHandler>;
