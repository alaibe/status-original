import { orderConversations, type ChatPrefs } from '@/core/messaging/chat-prefs';
import { useChatStore } from '@/core/messaging/chat-store';
import { matchesFilter, networkOf, type ChatFilter } from '@/core/messaging/folders';
import { messagePreview } from '@/core/messaging/preview';
import type { Conversation } from '@/core/messaging/types';
import { MARKED_UNREAD, unreadBadge } from '@/core/messaging/unread';

import {
  chatLabels,
  displayNames,
  findChat,
  findMessage,
  loadedMessages,
  messageJson,
  messageLine,
  readyChat,
  visible,
  whenAccountReady,
  type ChatLabel,
  type CliHandler,
} from '../context';
import { CliError } from '../errors';
import type { ParsedArgs } from '../args';

function chatJson(c: Conversation, label: ChatLabel = { title: c.title }) {
  const { chatPrefs, readAt, drafts } = useChatStore.getState();
  const prefs = chatPrefs[c.id] ?? {};
  return {
    id: c.id,
    title: label.title,
    ...(label.peer ? { peer: label.peer, address: label.address } : {}),
    kind: c.kind,
    network: networkOf(c) ?? 'local',
    unread: unreadBadge(c, readAt[c.id] ?? 0),
    markedUnread: readAt[c.id] === MARKED_UNREAD || Boolean(c.markedUnread),
    mentions: c.mentionCount ?? 0,
    lastMessage: c.lastMessage ? messagePreview(c.lastMessage) : undefined,
    lastAt: c.lastMessage ? new Date(c.lastMessage.sentAt).toISOString() : undefined,
    request: c.consent === 'unknown',
    blocked: c.consent === 'denied',
    pinned: Boolean(prefs.pinned),
    muted: Boolean(prefs.muted),
    archived: Boolean(prefs.archived),
    canSend: c.canSend !== false,
    ...(drafts[c.id] || c.draft ? { draft: drafts[c.id] ?? c.draft } : {}),
  };
}

function chatLine(c: ReturnType<typeof chatJson>): string {
  const marks = [
    c.unread ? `${c.unread} unread` : c.markedUnread ? 'unread' : '',
    c.pinned ? 'pinned' : '',
    c.muted ? 'muted' : '',
  ].filter(Boolean);
  return (
    `${c.title}  (${c.network} ${c.kind}${marks.length ? `, ${marks.join(', ')}` : ''})  ${c.id}` +
    (c.lastMessage ? `\n    ${c.lastMessage.slice(0, 100)}` : '')
  );
}

function setPref(change: Partial<ChatPrefs>, done: string): CliHandler {
  return async ({ args }) => {
    const chat = await readyChat(args.chat!);
    await useChatStore.getState().setChatPref(chat.id, change);
    return { data: { id: chat.id, ...change }, text: `${done} ${chat.label}.` };
  };
}

async function readChat({ args, flags }: ParsedArgs) {
  const chat = await readyChat(args.chat!);
  const count = Number(flags.limit ?? 20);
  if (!Number.isInteger(count) || count <= 0)
    throw new CliError('--limit takes a positive number.', 'usage');

  await loadedMessages(chat.id);
  const cutoff =
    typeof flags.before === 'string' ? await findMessage(chat.id, flags.before) : undefined;
  const raw = () => useChatStore.getState().messages[chat.id] ?? [];
  const shown = () => raw().filter(visible);
  const endOf = () => (cutoff ? shown().findIndex((m) => m.id === cutoff.id) : shown().length);
  while (endOf() < count && useChatStore.getState().messageHistory[chat.id]?.hasOlder !== false) {
    const before = raw().length;
    await useChatStore.getState().loadOlderMessages(chat.id);
    if (raw().length === before) break;
  }
  const end = endOf();
  const page = shown().slice(Math.max(0, end - count), end);
  if (flags['mark-read']) await useChatStore.getState().markRead(chat.id);

  const names = await displayNames(
    chat.protocol,
    page.map((m) => m.senderId)
  );
  return {
    data: page.map((m) => messageJson(m, names)),
    text: page.length ? page.map((m) => messageLine(m, names)) : 'No messages.',
  };
}

const FILTERS: ChatFilter[] = ['unread', 'mentions'];

export const chatHandlers = {
  async chats({ flags }) {
    await whenAccountReady();
    const { conversations, chatPrefs, readAt } = useChatStore.getState();
    const context = { prefs: chatPrefs, readAt };
    const limit = flags.limit === undefined ? Infinity : Number(flags.limit);
    const picked = conversations.filter((c) => {
      if (Boolean(flags.requests) !== (c.consent === 'unknown')) return false;
      if (!flags.requests && c.consent === 'denied') return false;
      if (Boolean(flags.archived) !== Boolean(chatPrefs[c.id]?.archived)) return false;
      if (flags.dms && !matchesFilter(c, 'direct', context)) return false;
      if (flags.groups && !matchesFilter(c, 'groups', context)) return false;
      if (typeof flags.network === 'string' && networkOf(c) !== flags.network.toLowerCase())
        return false;
      return FILTERS.every((f) => !flags[f] || matchesFilter(c, f, context));
    });
    const ordered = orderConversations(picked, chatPrefs, { includeArchived: true }).slice(
      0,
      limit
    );
    const labels = await chatLabels(ordered);
    const data = ordered.map((c) => chatJson(c, labels.get(c.id)));
    return { data, text: data.length ? data.map(chatLine) : 'No chats.' };
  },

  async chat({ args }) {
    const chat = await readyChat(args.chat!);
    const store = useChatStore.getState();
    const info = chat.kind === 'dm' ? {} : await store.getGroupInfo(chat.id).catch(() => ({}));
    const data = {
      ...chatJson(chat, { title: chat.label, peer: chat.peer, address: chat.address }),
      members: chat.memberIds.length,
      role: chat.selfRole,
      online: chat.online,
      lastSeenAt: chat.lastSeenAt ? new Date(chat.lastSeenAt).toISOString() : undefined,
      pendingJoinRequests: chat.pendingJoinRequests,
      ...info,
    };
    const lines = Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== false && value !== '')
      .map(
        ([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`
      );
    return { data, text: lines };
  },

  read: readChat,

  async search({ args, flags }) {
    await whenAccountReady();
    const inChat = typeof flags.in === 'string' ? await findChat(flags.in) : undefined;
    const found = await useChatStore.getState().searchMessages(args.query!, inChat?.id);
    const inResults = new Set(found.map((m) => m.conversationId));
    const labels = await chatLabels(
      useChatStore.getState().conversations.filter((c) => inResults.has(c.id))
    );
    const titles = new Map([...labels].map(([id, l]) => [id, l.title]));
    return {
      data: found.map((m) => ({ ...messageJson(m), chatTitle: titles.get(m.conversationId) })),
      text: found.length
        ? found.map(
            (m) => `${titles.get(m.conversationId) ?? m.conversationId} › ${messageLine(m)}`
          )
        : 'Nothing found.',
    };
  },

  async 'mark-read'({ args }) {
    const chat = await readyChat(args.chat!);
    await useChatStore.getState().markRead(chat.id);
    return { data: { id: chat.id, read: true }, text: `Marked ${chat.label} as read.` };
  },

  async 'mark-unread'({ args }) {
    const chat = await readyChat(args.chat!);
    await useChatStore.getState().markUnread(chat.id);
    return { data: { id: chat.id, read: false }, text: `Marked ${chat.label} as unread.` };
  },

  async accept({ args }) {
    const chat = await readyChat(args.chat!);
    await useChatStore.getState().setConsent(chat.id, 'allowed');
    return {
      data: { id: chat.id, consent: 'allowed' },
      text: `Moved ${chat.label} to your chats.`,
    };
  },

  async block({ args }) {
    const chat = await readyChat(args.chat!);
    await useChatStore.getState().setConsent(chat.id, 'denied');
    return { data: { id: chat.id, consent: 'denied' }, text: `Blocked ${chat.label}.` };
  },

  pin: setPref({ pinned: true }, 'Pinned'),
  unpin: setPref({ pinned: false }, 'Unpinned'),
  mute: setPref({ muted: true }, 'Muted'),
  unmute: setPref({ muted: false }, 'Unmuted'),
  archive: setPref({ archived: true }, 'Archived'),
  unarchive: setPref({ archived: false }, 'Unarchived'),

  async draft({ args }) {
    const chat = await readyChat(args.chat!);
    if (args.text === undefined) {
      const text = useChatStore.getState().drafts[chat.id] ?? chat.draft ?? '';
      return { data: { id: chat.id, draft: text }, text: text || '(no draft)' };
    }
    const text = args.text;
    useChatStore.getState().setDraft(chat.id, text);
    return { data: { id: chat.id, draft: text }, text: text ? 'Draft saved.' : 'Draft cleared.' };
  },
} satisfies Record<string, CliHandler>;
