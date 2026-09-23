import { copyText } from '@/design';
import { plainText } from '@/core/messaging/markdown';
import type { ChatMessage } from '@/core/messaging/types';

import type { MessageAction } from './message-actions';

export interface ConversationActions {
  reply(message: ChatMessage): void;
  forward(message: ChatMessage): void;
  edit(message: ChatMessage): void;
  remove(message: ChatMessage, forEveryone: boolean): void;
  retry(message: ChatMessage): void;
  togglePin(message: ChatMessage): void;
}

export interface ActionSupport {
  edit: boolean;
  delete: boolean;
  deleteForMe: boolean;
  deleteOthers: boolean;
  pin: boolean;
}

export function messageActions(
  message: ChatMessage,
  actions: ConversationActions,
  can: ActionSupport
): MessageAction[] {
  const sent = message.status === 'sent';
  const mine = message.fromMe && sent;
  const copy = copyableText(message.content);
  const menu: (MessageAction | false)[] = [
    message.status === 'failed' && {
      id: 'retry',
      label: 'Try again',
      icon: 'refresh-outline',
      onPress: () => actions.retry(message),
    },
    !message.privateToMe && {
      id: 'reply',
      label: 'Reply',
      icon: 'arrow-undo-outline',
      onPress: () => actions.reply(message),
    },
    !!copy && {
      id: 'copy',
      label: 'Copy',
      icon: 'copy-outline',
      onPress: () => void copyText(copy),
    },
    {
      id: 'forward',
      label: 'Forward',
      icon: 'arrow-redo-outline',
      onPress: () => actions.forward(message),
    },
    can.edit &&
      mine &&
      message.content.kind === 'text' && {
        id: 'edit',
        label: 'Edit',
        icon: 'create-outline',
        onPress: () => actions.edit(message),
      },
    can.pin &&
      sent && {
        id: 'pin',
        label: message.isPinned ? 'Unpin message' : 'Pin message',
        icon: 'pin-outline',
        onPress: () => actions.togglePin(message),
      },
    can.deleteForMe &&
      sent && {
        id: 'delete-for-me',
        label: 'Delete for me',
        icon: 'trash-outline',
        tone: 'danger',
        onPress: () => actions.remove(message, false),
      },
    can.delete &&
      sent &&
      (message.fromMe || can.deleteOthers) && {
        id: 'delete',
        label: 'Delete for everyone',
        icon: 'trash-outline',
        tone: 'danger',
        onPress: () => actions.remove(message, true),
      },
  ];
  return menu.filter((action): action is MessageAction => action !== false);
}

export function copyableText(content: ChatMessage['content']): string | undefined {
  switch (content.kind) {
    case 'text':
      return plainText(content.text);
    case 'system':
      return content.text;
    case 'image':
    case 'video':
      return content.caption || undefined;
    case 'file':
      return content.name;
    case 'custom':
    case 'widget':
      return content.fallback || undefined;
    default:
      return undefined;
  }
}
