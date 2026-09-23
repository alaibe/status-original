import type {
  ChatMessage,
  ConversationId,
  MessageContent,
  MessageId,
} from '@/core/messaging/types';

import type { TdObject } from './api';
import { plainFormatted } from './formatting';
import { messageIdOf, tdMessageId } from './ids';
import type { Outbox } from './outbox';
import { inputContent } from './outgoing';
import type { TdMessage } from './types';
import type { TelegramHost } from './service-host';

interface TdMessageProperties extends TdObject {
  can_be_edited: boolean;
  can_be_deleted_for_all_users: boolean;
  can_be_pinned: boolean;
}

export class TelegramMessages {
  constructor(
    private readonly host: TelegramHost,
    private readonly outbox: Outbox
  ) {}

  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    const chatId = Number(id);

    if (content.kind === 'reaction') {
      const reaction = { '@type': 'reactionTypeEmoji', emoji: content.emoji };
      await this.host.api().send(
        content.action === 'added'
          ? {
              '@type': 'addMessageReaction',
              chat_id: chatId,
              message_id: tdMessageId(content.targetId),
              reaction_type: reaction,
              is_big: false,
              update_recent_reactions: false,
            }
          : {
              '@type': 'removeMessageReaction',
              chat_id: chatId,
              message_id: tdMessageId(content.targetId),
              reaction_type: reaction,
            }
      );
      return `${content.targetId}_reaction`;
    }

    const request: TdObject = {
      '@type': 'sendMessage',
      chat_id: chatId,
      input_message_content: inputContent(content),
    };
    if (replyTo) {
      request.reply_to = {
        '@type': 'inputMessageReplyToMessage',
        message_id: tdMessageId(replyTo),
      };
    }
    const sent = await this.host.api().send<TdMessage>(request);
    const final = await this.outbox.await(sent);
    return messageIdOf(chatId, final.id);
  }

  async editMessage(id: ConversationId, messageId: MessageId, text: string): Promise<void> {
    const properties = await this.properties(Number(id), tdMessageId(messageId));
    if (!properties.can_be_edited) throw new Error('Telegram does not allow editing this message.');
    const message = await this.host.api().send<TdMessage>({
      '@type': 'editMessageText',
      chat_id: Number(id),
      message_id: tdMessageId(messageId),
      reply_markup: null,
      input_message_content: inputContent({ kind: 'text', text }),
    });
    await this.host.emitMessage(message);
  }

  async deleteMessage(id: ConversationId, messageId: MessageId): Promise<void> {
    const properties = await this.properties(Number(id), tdMessageId(messageId));
    if (!properties.can_be_deleted_for_all_users)
      throw new Error('Telegram does not allow deleting this message for everyone.');
    await this.deleteMessages(id, messageId, true);
  }

  deleteMessageForMe(id: ConversationId, messageId: MessageId): Promise<void> {
    return this.deleteMessages(id, messageId, false);
  }

  private async deleteMessages(id: ConversationId, messageId: MessageId, revoke: boolean) {
    await this.host.api().send({
      '@type': 'deleteMessages',
      chat_id: Number(id),
      message_ids: [tdMessageId(messageId)],
      revoke,
    });
  }

  async votePoll(id: ConversationId, messageId: MessageId, optionIds: number[]): Promise<void> {
    const chatId = Number(id);
    const tdId = tdMessageId(messageId);
    await this.host.api().send({
      '@type': 'setPollAnswer',
      chat_id: chatId,
      message_id: tdId,
      option_ids: optionIds,
    });
    await this.host.refetch(chatId, tdId);
  }

  async createPoll(id: ConversationId, question: string, options: string[]): Promise<void> {
    const chatId = Number(id);
    const sent = await this.host.api().send<TdMessage>({
      '@type': 'sendMessage',
      chat_id: chatId,
      input_message_content: {
        '@type': 'inputMessagePoll',
        question: plainFormatted(question),
        options: options.map((option) => plainFormatted(option)),
        is_anonymous: true,
        type: { '@type': 'pollTypeRegular', allow_multiple_answers: false },
        open_period: 0,
        close_date: 0,
        is_closed: false,
      },
    });
    await this.outbox.await(sent);
  }

  async listPinnedMessages(id: ConversationId): Promise<ChatMessage[]> {
    const chatId = Number(id);
    const found = new Map<number, TdMessage>();
    let from = 0;
    while (true) {
      const page = await this.host.api().send<{
        '@type': string;
        messages: TdMessage[];
        next_from_message_id: number;
      }>({
        '@type': 'searchChatMessages',
        chat_id: chatId,
        topic_id: null,
        query: '',
        sender_id: null,
        from_message_id: from,
        offset: 0,
        limit: 100,
        filter: { '@type': 'searchMessagesFilterPinned' },
      });
      for (const message of page.messages) found.set(message.id, message);
      if (!page.next_from_message_id || page.next_from_message_id === from) break;
      from = page.next_from_message_id;
    }
    return [...found.values()].map((message) => this.host.toMessage(message, false));
  }

  async searchMessages(query: string, id?: ConversationId): Promise<ChatMessage[]> {
    const page = id
      ? await this.host.api().send<{ '@type': string; messages: TdMessage[] }>({
          '@type': 'searchChatMessages',
          chat_id: Number(id),
          topic_id: null,
          query,
          sender_id: null,
          from_message_id: 0,
          offset: 0,
          limit: 100,
          filter: null,
        })
      : await this.host.api().send<{ '@type': string; messages: TdMessage[] }>({
          '@type': 'searchMessages',
          chat_list: null,
          query,
          offset: '',
          limit: 100,
          filter: null,
          chat_type_filter: null,
          min_date: 0,
          max_date: 0,
        });
    return page.messages.map((message) => this.host.toMessage(message, false));
  }

  async setMessagePinned(id: ConversationId, messageId: MessageId, pinned: boolean): Promise<void> {
    const chatId = Number(id);
    const tdId = tdMessageId(messageId);
    const properties = await this.properties(chatId, tdId);
    if (!properties.can_be_pinned) throw new Error('Telegram does not allow pinning this message.');
    await this.host.api().send(
      pinned
        ? {
            '@type': 'pinChatMessage',
            chat_id: chatId,
            message_id: tdId,
            disable_notification: true,
            only_for_self: false,
          }
        : { '@type': 'unpinChatMessage', chat_id: chatId, message_id: tdId }
    );
    await this.host.refetch(chatId, tdId);
  }

  private properties(chatId: number, messageId: number) {
    return this.host.api().send<TdMessageProperties>({
      '@type': 'getMessageProperties',
      chat_id: chatId,
      message_id: messageId,
    });
  }
}
