import { TdRequestError, type TdApi, type TdObject } from '../api';
import type { TdChat, TdChatPosition, TdMessage, TdUser } from '../types';

type Handler = (request: TdObject) => TdObject;

/**
 * TDLib as a scripted peer: requests are answered by handlers keyed on
 * `@type`, and tests push updates with `emit`. Unhandled requests get `ok`.
 */
export class FakeTdlib implements TdApi {
  readonly sent: TdObject[] = [];
  readonly handlers = new Map<string, Handler>();
  closed = false;
  destroyed = false;
  private readonly listeners = new Set<(update: TdObject) => void>();

  send<T extends TdObject = TdObject>(request: TdObject): Promise<T> {
    this.sent.push(request);
    const handler = this.handlers.get(request['@type']);
    const response = handler ? handler(request) : { '@type': 'ok' };
    if (response['@type'] === 'error') {
      return Promise.reject(
        new TdRequestError(response.code as number, response.message as string)
      );
    }
    return Promise.resolve(response as T);
  }

  onUpdate(listener: (update: TdObject) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  emit(update: TdObject): void {
    for (const listener of this.listeners) listener(update);
  }

  answer(type: string, handler: Handler | TdObject): void {
    this.handlers.set(type, typeof handler === 'function' ? handler : () => handler);
  }

  requests(type: string): TdObject[] {
    return this.sent.filter((request) => request['@type'] === type);
  }
}

export function tdError(code: number, message: string): TdObject {
  return { '@type': 'error', code, message };
}

export function authState(type: string, extra: Record<string, unknown> = {}): TdObject {
  return { '@type': 'updateAuthorizationState', authorization_state: { '@type': type, ...extra } };
}

export function user(id: number, first: string, last = '', username?: string): TdUser {
  return {
    '@type': 'user',
    id,
    first_name: first,
    last_name: last,
    ...(username ? { usernames: { active_usernames: [username] } } : {}),
    phone_number: '',
    type: { '@type': 'userTypeRegular' },
  };
}

export const MAIN_POSITION: TdChatPosition = { list: { '@type': 'chatListMain' }, order: '1' };

export function privateChat(userId: number, title: string, positions = [MAIN_POSITION]): TdChat {
  return {
    '@type': 'chat',
    id: userId,
    type: { '@type': 'chatTypePrivate', user_id: userId },
    title,
    positions,
    last_read_outbox_message_id: 0,
  };
}

export function groupChat(
  basicGroupId: number,
  title: string,
  positions = [MAIN_POSITION]
): TdChat {
  return {
    '@type': 'chat',
    id: -basicGroupId,
    type: { '@type': 'chatTypeBasicGroup', basic_group_id: basicGroupId },
    title,
    positions,
    last_read_outbox_message_id: 0,
  };
}

export function channelChat(supergroupId: number, title: string): TdChat {
  return {
    '@type': 'chat',
    id: -1_000_000_000_000 - supergroupId,
    type: { '@type': 'chatTypeSupergroup', supergroup_id: supergroupId, is_channel: true },
    title,
    positions: [MAIN_POSITION],
    last_read_outbox_message_id: 0,
  };
}

export function textMessage(
  chatId: number,
  id: number,
  senderUserId: number,
  text: string,
  opts: { outgoing?: boolean; date?: number; pending?: boolean; replyTo?: number } = {}
): TdMessage {
  return {
    '@type': 'message',
    id,
    chat_id: chatId,
    sender_id: { '@type': 'messageSenderUser', user_id: senderUserId },
    date: opts.date ?? 1_700_000_000 + id,
    is_outgoing: opts.outgoing ?? false,
    ...(opts.pending ? { sending_state: { '@type': 'messageSendingStatePending' } } : {}),
    ...(opts.replyTo
      ? {
          reply_to: { '@type': 'messageReplyToMessage', chat_id: chatId, message_id: opts.replyTo },
        }
      : {}),
    content: { '@type': 'messageText', text: { '@type': 'formattedText', text, entities: [] } },
  };
}

export function photoMessage(
  chatId: number,
  id: number,
  senderUserId: number,
  file: { id: number; path: string; downloaded: boolean },
  caption = ''
): TdMessage {
  return {
    ...textMessage(chatId, id, senderUserId, ''),
    content: {
      '@type': 'messagePhoto',
      photo: {
        sizes: [
          {
            type: 'y',
            width: 800,
            height: 600,
            photo: {
              '@type': 'file',
              id: file.id,
              size: 1234,
              local: {
                path: file.downloaded ? file.path : '',
                is_downloading_completed: file.downloaded,
                is_downloading_active: false,
              },
            },
          },
        ],
      },
      caption: { '@type': 'formattedText', text: caption, entities: [] },
    },
  };
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
