import { create } from 'zustand';

import { reportError } from '../app/report-error';

import {
  botConversationId,
  botIdFromConversation,
  isLocalConversation,
  SAVED_LOCAL_ID,
  toContent,
  type Bot,
} from './bots';
import {
  LOCAL_PROTOCOL,
  namespaceConversation,
  namespaceMessage,
  namespacedId,
  splitConversationId,
  type ProtocolId,
} from './namespace';
import { saveChatPrefs, withPref, type ChatPrefs, type ChatPrefsMap } from './chat-prefs';
import { indexMessages, saveMediaIndexSoon, type MediaIndex } from './media-index';
import { useAppearanceStore } from '../app/appearance';
import { writeReadState } from './read-state';
import { foldReactions, hasReacted } from './reactions';
import type {
  ChatSession,
  GroupInfo,
  JoinRequest,
  MentionCandidate,
  PublicChatPreview,
  XmtpCapabilities,
} from './protocol';
import { historyFailure } from './history';
import { HYDRATE_LIMIT, type MessageStore } from './message-store';
import { persistLocalAttachment } from './attachments';
import { MARKED_UNREAD } from './unread';
import { searchMessages } from './search';
import { draftKey, draftSync, saveDraftsSoon, withDraft, type Drafts } from './drafts';
import { capability, type Capability, type CapabilityMethod } from './capability';
import type { AccountStorage } from '@/storage/account';
import type {
  ChatMessage,
  MessageId,
  Conversation,
  ConversationId,
  GroupMember,
  MessageContent,
  ParticipantId,
  Unsubscribe,
} from './types';
import { errorMessage, NotConnectedError } from '../errors';
import { sameValue } from '@/lib/same-value';

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'erasing';

export interface ProtocolConnection {
  status: ConnectionStatus;
  error: string | null;
  history?: import('./history').HistoryState;
  login?: import('./protocol').LoginState | null;
}

export interface ChatState {
  status: ConnectionStatus;
  error: string | null;
  sessions: Record<ProtocolId, ChatSession>;
  protocols: Record<ProtocolId, ProtocolConnection>;
  accountId: string | null;

  conversations: Conversation[];
  messages: Record<ConversationId, ChatMessage[]>;
  rawMessages: Record<ConversationId, ChatMessage[]>;
  messageHistory: Record<ConversationId, MessageHistoryState>;
  syncing: boolean;
  bots: Record<string, Bot>;
  readAt: Record<ConversationId, number>;
  chatPrefs: ChatPrefsMap;
  drafts: Drafts;
  mediaIndex: MediaIndex;
  messageStore: MessageStore | null;
  accountStorage: AccountStorage | null;

  registerBots(bots: Bot[]): Promise<void>;
  postLocalMessage(id: ConversationId, content: MessageContent, from: 'me' | 'bot'): Promise<void>;

  postPrivateMessage(id: ConversationId, content: MessageContent): Promise<void>;

  refreshConversations(): Promise<void>;
  loadMessages(id: ConversationId): Promise<void>;
  loadOlderMessages(id: ConversationId): Promise<void>;
  searchMessages(query: string, id?: ConversationId): Promise<ChatMessage[]>;
  sendMessage(
    id: ConversationId,
    content: MessageContent,
    replyTo?: MessageId,
    threadRoot?: MessageId
  ): Promise<SendOutcome>;
  resolvePeer(protocol: ProtocolId, addressOrId: string): Promise<ParticipantId | null>;
  startDm(protocol: ProtocolId, peer: ParticipantId): Promise<Conversation>;
  startGroup(protocol: ProtocolId, peers: ParticipantId[], title: string): Promise<Conversation>;
  previewPublicChat(protocol: ProtocolId, input: string): Promise<PublicChatPreview>;
  joinPublicChat(protocol: ProtocolId, id: ConversationId): Promise<Conversation | null>;
  createInviteLink(id: ConversationId, requiresApproval: boolean): Promise<string>;
  getJoinRequests(id: ConversationId): Promise<JoinRequest[]>;
  processJoinRequest(id: ConversationId, userId: ParticipantId, approve: boolean): Promise<void>;
  sync(): Promise<void>;
  syncProtocol(protocolId: ProtocolId): Promise<void>;

  getMembers(id: ConversationId): Promise<GroupMember[]>;
  mentionCandidates(id: ConversationId, query: string): Promise<MentionCandidate[]>;
  getGroupInfo(id: ConversationId): Promise<GroupInfo>;
  setSlowModeDelay(id: ConversationId, seconds: number): Promise<void>;
  addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void>;
  banMember(id: ConversationId, peer: ParticipantId): Promise<void>;
  setMemberMuted(id: ConversationId, peer: ParticipantId, muted: boolean): Promise<void>;
  renameGroup(id: ConversationId, title: string): Promise<void>;
  leaveGroup(id: ConversationId): Promise<void>;

  react(conversationId: ConversationId, messageId: MessageId, emoji: string): Promise<void>;

  markRead(id: ConversationId): Promise<void>;
  setTyping(id: ConversationId, typing: boolean): Promise<void>;
  watchPresence(id: ConversationId): Unsubscribe;
  markUnread(id: ConversationId): Promise<void>;
  setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void>;
  setChatPref(id: ConversationId, change: Partial<ChatPrefs>): Promise<void>;
  setDraft(id: ConversationId, text: string, thread?: MessageId): void;

  ingestMessage(message: ChatMessage): void;
  ingestConversation(conversation: Conversation): void;
  ingestConversations(conversations: Conversation[]): void;
  replacePending(
    conversationId: ConversationId,
    pendingId: string,
    status: ChatMessage['status'],
    sentId?: MessageId
  ): void;
  retryMessage(conversationId: ConversationId, messageId: string): Promise<SendOutcome | null>;
  editMessage(id: ConversationId, messageId: MessageId, text: string): Promise<void>;
  deleteMessage(id: ConversationId, messageId: MessageId, forEveryone: boolean): Promise<void>;
  votePoll(id: ConversationId, messageId: MessageId, optionIds: number[]): Promise<void>;
  createPoll(id: ConversationId, question: string, options: string[]): Promise<void>;
  listPinnedMessages(id: ConversationId): Promise<ChatMessage[]>;
  setMessagePinned(id: ConversationId, messageId: MessageId, pinned: boolean): Promise<void>;
  fetchMedia(id: ConversationId, messageId: MessageId): Promise<void>;
  removeMessages(id: ConversationId, messageIds: MessageId[]): void;
}

/** A failed send stays in the chat, marked, for the person to retry; the error is only reported. */
export type SendOutcome = { sent: true } | { sent: false; messageId: MessageId; error: unknown };

export interface MessageHistoryState {
  loading: boolean;
  hasOlder: boolean;
  error?: string;
}

const PRIMARY_PROTOCOL: ProtocolId = 'xmtp';

const FIRST_PAGE = 50;

export const EMPTY_PROJECTION = {
  status: 'idle',
  error: null,
  sessions: {},
  protocols: {},
  accountId: null,
  accountStorage: null,
  messageStore: null,
  conversations: [],
  messages: {},
  rawMessages: {},
  messageHistory: {},
  syncing: false,
  bots: {},
  readAt: {},
  chatPrefs: {},
  drafts: {},
  mediaIndex: {},
} satisfies Partial<ChatState>;

export const useChatStore = create<ChatState>((set, get) => ({
  ...EMPTY_PROJECTION,

  async refreshConversations() {
    const accountId = get().accountId;
    const entries = Object.entries(get().sessions);
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([protocolId, session]) =>
        (await session.listConversations()).map((c) => namespaceConversation(protocolId, c))
      )
    );

    const remote = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (!sameSessions(get(), accountId, entries)) return;
    const local = get().conversations.filter((c) => isLocalConversation(c.id));
    set({ conversations: sortConversations([...local, ...remote]) });
  },

  async loadMessages(id) {
    if (!isLocalConversation(id) && !routeOrNull(get(), id)) return;
    const accountId = get().accountId;
    const opened = get().messageHistory[id];
    const project = (
      page: ChatMessage[],
      hasOlder: boolean,
      loading = false,
      merge = mergePage
    ) => {
      set((state) => ({
        ...withRaw(state, id, merge(rawOf(state, id), page)),
        messageHistory: { ...state.messageHistory, [id]: { loading, hasOlder } },
      }));
      const indexed = indexMessages(get().mediaIndex, id, page);
      if (indexed !== get().mediaIndex) {
        set({ mediaIndex: indexed });
        saveMediaIndexSoon(requireAccountStorage(get()), indexed);
      }
    };

    try {
      const newest = await loadMessagePage(get(), id, FIRST_PAGE);
      if (get().accountId !== accountId) return;
      const more = newest.length === FIRST_PAGE;
      if (opened) {
        project(newest, opened.error ? more : opened.hasOlder);
        return;
      }
      project(newest, more, more);
      if (!more) return;

      const rest = HYDRATE_LIMIT - FIRST_PAGE;
      const older = await loadMessagePage(get(), id, rest, newest);
      if (get().accountId !== accountId) return;
      project(older, older.length === rest, false, (loaded, page) => dedupe([...page, ...loaded]));
    } catch (error) {
      if (get().accountId !== accountId) return;
      set((state) => ({
        messageHistory: {
          ...state.messageHistory,
          [id]: {
            loading: false,
            hasOlder: state.messageHistory[id]?.hasOlder ?? false,
            error: errorMessage(error, 'Could not load messages'),
          },
        },
      }));
    }
  },

  async loadOlderMessages(id) {
    const current = get().messageHistory[id];
    if (current?.loading || current?.hasOlder === false) return;
    const existing = get().messages[id] ?? [];
    if (existing.length === 0) return;
    const accountId = get().accountId;

    set((state) => ({
      messageHistory: {
        ...state.messageHistory,
        [id]: { ...state.messageHistory[id], loading: true, hasOlder: true, error: undefined },
      },
    }));

    try {
      const page = await loadMessagePage(get(), id, 100, existing);
      if (get().accountId !== accountId) return;
      set((state) => ({
        ...withRaw(state, id, dedupe([...page, ...rawOf(state, id)])),
        messageHistory: {
          ...state.messageHistory,
          [id]: { loading: false, hasOlder: page.length === 100 },
        },
      }));
    } catch (error) {
      if (get().accountId !== accountId) return;
      set((state) => ({
        messageHistory: {
          ...state.messageHistory,
          [id]: {
            loading: false,
            hasOlder: true,
            error: errorMessage(error, 'Could not load earlier messages'),
          },
        },
      }));
    }
  },

  searchMessages(query, id) {
    return searchMessages(get(), query, id);
  },

  async sendMessage(id, picked, replyTo, threadRoot) {
    requireSendable(get(), id);
    if (isLocalConversation(id)) {
      await get().postLocalMessage(id, picked, 'me');

      const bot = get().bots[botIdFromConversation(id)];
      if (bot?.onMessage && picked.kind === 'text') {
        await bot.onMessage(picked.text, {
          conversationId: id,
          say: (reply) => get().postLocalMessage(id, toContent(reply), 'bot'),
        });
      }
      return { sent: true };
    }

    const route = requireRoute(get(), id);
    const accountId = get().accountId;
    const pendingId = `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const content =
      'uri' in picked && accountId
        ? await persistLocalAttachment(pendingId, picked, accountId)
        : picked;

    const pending: ChatMessage = {
      id: pendingId,
      conversationId: id,
      senderId: route.session.self.participantId,
      sentAt: Date.now(),
      content,
      fromMe: true,
      status: 'sending',
      replyTo,
      threadRoot,
    };
    set((state) => withRaw(state, id, [...rawOf(state, id), pending]));

    try {
      const sentId = await route.session.send(route.nativeId, content, replyTo, threadRoot);
      get().replacePending(id, pending.id, 'sent', sentId);
      return { sent: true };
    } catch (error) {
      get().replacePending(id, pending.id, 'failed');
      console.warn('[chat] send failed', error);
      reportError(error);
      return { sent: false, messageId: pending.id, error };
    }
  },

  async retryMessage(id, messageId) {
    const message = (get().messages[id] ?? []).find((m) => m.id === messageId);
    if (!message || message.status !== 'failed') return null;

    const route = requireRoute(get(), id);
    get().replacePending(id, messageId, 'sending');

    try {
      const sentId = await route.session.send(
        route.nativeId,
        message.content,
        message.replyTo,
        message.threadRoot
      );
      get().replacePending(id, messageId, 'sent', sentId);
      return { sent: true };
    } catch (error) {
      get().replacePending(id, messageId, 'failed');
      console.warn('[chat] retry failed', error);
      reportError(error);
      return { sent: false, messageId, error };
    }
  },

  editMessage(id, messageId, text) {
    return onChat(get(), id, 'editMessage', messageId, text);
  },

  async deleteMessage(id, messageId, forEveryone) {
    const accountId = get().accountId;
    const route = requireRoute(get(), id);
    const remove = capability(route.session, forEveryone ? 'deleteMessage' : 'deleteMessageForMe');
    await remove(route.nativeId, messageId);
    if (!sameSession(get(), accountId, route.protocol, route.session)) return;
    get().removeMessages(id, [messageId]);
  },

  votePoll(id, messageId, optionIds) {
    return onChat(get(), id, 'votePoll', messageId, optionIds);
  },

  createPoll(id, question, options) {
    requireSendable(get(), id);
    return onChat(get(), id, 'createPoll', question, options);
  },

  async listPinnedMessages(id) {
    const protocol = requireRoute(get(), id).protocol;
    return (await onChat(get(), id, 'listPinnedMessages')).map((message) =>
      namespaceMessage(protocol, message)
    );
  },

  setMessagePinned(id, messageId, pinned) {
    return onChat(get(), id, 'setMessagePinned', messageId, pinned);
  },

  fetchMedia(id, messageId) {
    return onChat(get(), id, 'fetchMedia', messageId);
  },

  removeMessages(id, messageIds) {
    const removed = new Set(messageIds);
    set((state) => {
      const raw = state.rawMessages[id] ?? state.messages[id];
      const kept = raw?.filter((message) => !removed.has(message.id));
      const existing = state.mediaIndex[id];
      const indexed = existing?.filter((entry) => !removed.has(entry.messageId));
      const mediaIndex =
        indexed && indexed.length !== existing?.length
          ? { ...state.mediaIndex, [id]: indexed }
          : state.mediaIndex;
      if (mediaIndex !== state.mediaIndex && state.accountStorage)
        saveMediaIndexSoon(state.accountStorage, mediaIndex);
      return {
        ...(kept ? withRaw(state, id, kept) : {}),
        mediaIndex,
        conversations: sortConversations(
          state.conversations.map((conversation) =>
            conversation.id === id &&
            conversation.lastMessage &&
            removed.has(conversation.lastMessage.id)
              ? { ...conversation, lastMessage: kept?.at(-1) }
              : conversation
          )
        ),
      };
    });
  },

  async resolvePeer(protocol, addressOrId) {
    const session = get().sessions[protocol];
    if (!session) throw new NotConnectedError(protocol);
    return session.resolvePeer(addressOrId);
  },

  startDm(protocol, peer) {
    return startConversation(get, protocol, (session) => session.createDm(peer));
  },

  startGroup(protocol, peers, title) {
    return startConversation(get, protocol, (session) => session.createGroup(peers, title));
  },

  previewPublicChat(protocol, input) {
    return capability(requireSession(get(), protocol), 'previewPublicChat')(input);
  },

  joinPublicChat(protocol, id) {
    return joinConversation(get, protocol, (session) => capability(session, 'joinPublicChat')(id));
  },

  createInviteLink(id, requiresApproval) {
    return onChat(get(), id, 'createInviteLink', requiresApproval);
  },

  getJoinRequests(id) {
    return onChat(get(), id, 'getJoinRequests');
  },

  processJoinRequest(id, userId, approve) {
    return onChat(get(), id, 'processJoinRequest', userId, approve);
  },

  async getMembers(id) {
    const route = requireRoute(get(), id);
    return route.session.getMembers(route.nativeId);
  },

  mentionCandidates(id, query) {
    return onChat(get(), id, 'mentionCandidates', query);
  },

  getGroupInfo(id) {
    return onChat(get(), id, 'getGroupInfo');
  },

  setSlowModeDelay(id, seconds) {
    return onChat(get(), id, 'setSlowModeDelay', seconds);
  },

  addMembers(id, peers) {
    return afterRoute(get, id, (route) => route.session.addMembers(route.nativeId, peers));
  },

  removeMembers(id, peers) {
    return afterRoute(get, id, (route) => route.session.removeMembers(route.nativeId, peers));
  },

  banMember(id, peer) {
    return onChat(get(), id, 'banMember', peer);
  },

  setMemberMuted(id, peer, muted) {
    return onChat(get(), id, 'setMemberMuted', peer, muted);
  },

  renameGroup(id, title) {
    return afterRoute(get, id, (route) => route.session.renameGroup(route.nativeId, title));
  },

  async leaveGroup(id) {
    const accountId = get().accountId;
    const route = requireRoute(get(), id);
    await route.session.leaveGroup(route.nativeId);
    if (!sameSession(get(), accountId, route.protocol, route.session)) return;

    set((state) => {
      const { [id]: _messages, ...messages } = state.messages;
      const { [id]: _raw, ...rawMessages } = state.rawMessages;
      return {
        conversations: state.conversations.filter((c) => c.id !== id),
        messages,
        rawMessages,
      };
    });
  },

  async sync() {
    const sessions = Object.entries(get().sessions);
    if (sessions.length === 0 || get().syncing) return;
    const accountId = get().accountId;
    set({ syncing: true });
    try {
      await Promise.allSettled(sessions.map(([protocolId]) => get().syncProtocol(protocolId)));
    } finally {
      if (
        get().accountId === accountId &&
        sessions.every(([id, session]) => get().sessions[id] === session)
      ) {
        set({ syncing: false });
      }
    }
  },

  async syncProtocol(protocolId) {
    const session = get().sessions[protocolId];
    if (!session || get().protocols[protocolId]?.history?.status === 'fetching') return;
    const accountId = get().accountId;
    const current = () => get().accountId === accountId && get().sessions[protocolId] === session;
    const report = (history: import('./history').HistoryState) => {
      if (current()) setProtocol(set, protocolId, { ...get().protocols[protocolId], history });
    };
    report({ status: 'fetching' });
    try {
      await session.sync();
      const conversations = (await session.listConversations()).map((conversation) =>
        namespaceConversation(protocolId, conversation)
      );
      if (!current()) return;
      get().ingestConversations(conversations);
      await Promise.all(
        conversations.map(({ id }) => (get().messages[id] ? get().loadMessages(id) : undefined))
      );
      report({ status: 'idle' });
    } catch (error) {
      report(historyFailure(error));
    }
  },

  async registerBots(bots) {
    const forAccount = get().accountId;
    const stale = () => get().accountId !== forAccount;

    const byId = Object.fromEntries(bots.map((b) => [b.id, b]));
    set({ bots: byId });
    const store = requireMessageStore(get());
    const localConversations = await store.loadConversations(LOCAL_PROTOCOL);
    if (stale()) return;
    const storedConversations = new Map(
      localConversations.map((conversation) => [conversation.id, conversation])
    );

    const fresh = bots.filter((bot) => {
      const id = botConversationId(bot.id);
      return !get().conversations.some((c) => c.id === id);
    });

    const loaded = await Promise.all(
      fresh.map(async (bot) => {
        const id = botConversationId(bot.id);
        const raw = await store.loadMessages(id, HYDRATE_LIMIT);
        const createdAt =
          storedConversations.get(id)?.createdAt ??
          raw[0]?.sentAt ??
          (id === SAVED_LOCAL_ID ? 0 : Date.now());
        await store.upsertConversation({
          id,
          protocolId: LOCAL_PROTOCOL,
          participants: [bot.id],
          title: bot.name,
          createdAt,
          hidden: false,
        });
        return { bot, raw, createdAt };
      })
    );
    if (stale()) return;

    if (loaded.length > 0) {
      set((state) => {
        let next = { messages: state.messages, rawMessages: state.rawMessages };
        const added: Conversation[] = [];
        const present = new Set(state.conversations.map((c) => c.id));
        for (const { bot, raw, createdAt } of loaded) {
          const id = botConversationId(bot.id);
          if (present.has(id)) continue;
          present.add(id);
          next = withRaw(next, id, raw);
          const messages = next.messages[id];
          added.push({
            id,
            protocol: LOCAL_PROTOCOL,
            kind: 'dm',
            title: bot.name,
            memberIds: [bot.id],
            createdAt,
            consent: 'allowed',
            lastMessage: messages.at(-1),
          });
        }
        return {
          conversations: sortConversations([...state.conversations, ...added]),
          ...next,
        };
      });
    }

    for (const { bot, raw } of loaded) {
      if (raw.length > 0) continue;
      const id = botConversationId(bot.id);
      for (const line of bot.greeting()) {
        if (stale()) return;
        await get().postLocalMessage(id, toContent(line), 'bot');
      }
    }

    if (stale()) return;

    const liveIds = new Set(bots.map((b) => botConversationId(b.id)));
    set((state) => ({
      conversations: state.conversations.filter(
        (c) => !isLocalConversation(c.id) || liveIds.has(c.id)
      ),
    }));
  },

  async postLocalMessage(id, content, from) {
    const accountId = get().accountId;
    const store = requireMessageStore(get());
    const messageId = `${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    if (!accountId) throw new Error('No account is active.');
    const storedContent = await persistLocalAttachment(messageId, content, accountId);
    if (get().accountId !== accountId) return;
    const previousSentAt = get().messages[id]?.at(-1)?.sentAt ?? 0;
    const message: ChatMessage = {
      id: messageId,
      conversationId: id,
      senderId: from === 'me' ? 'me' : botIdFromConversation(id),
      sentAt: Math.max(Date.now(), previousSentAt + 1),
      content: storedContent,
      fromMe: from === 'me',
      status: 'sent',
    };

    await store.insertMessage(message);
    if (get().accountId !== accountId || get().messageStore !== store) return;
    set((state) => ({
      ...withRaw(state, id, [...rawOf(state, id), message]),
      conversations: sortConversations(
        state.conversations.map((c) => (c.id === id ? { ...c, lastMessage: message } : c))
      ),
    }));
  },

  async postPrivateMessage(id, content) {
    const accountId = get().accountId;
    const store = requireMessageStore(get());
    const messageId = `private:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    if (!accountId) throw new Error('No account is active.');
    const message: ChatMessage = {
      id: messageId,
      conversationId: id,
      senderId: 'local',
      sentAt: Date.now(),
      content: await persistLocalAttachment(messageId, content, accountId),
      fromMe: false,
      status: 'sent',
      privateToMe: true,
    };

    await store.insertMessage(message);
    if (get().accountId !== accountId || get().messageStore !== store) return;
    set((state) => withRaw(state, id, [...rawOf(state, id), message]));
  },

  setDraft(id, text, thread) {
    const drafts = withDraft(get().drafts, draftKey(id, thread), text);
    set({ drafts });
    saveDraftsSoon(requireAccountStorage(get()), drafts);
    if (thread) return;
    const route = routeOrNull(get(), id);
    if (route?.session.saveDraft)
      draftSync.typed(id, text, (latest) =>
        capability(route.session, 'saveDraft')(route.nativeId, latest)
      );
  },

  async setChatPref(id, change) {
    const next = withPref(get().chatPrefs, id, change);
    set({ chatPrefs: next });
    await saveChatPrefs(requireAccountStorage(get()), next);
  },

  async markRead(id) {
    const now = Date.now();
    set((state) => ({ readAt: { ...state.readAt, [id]: now } }));
    await writeReadState(requireAccountStorage(get()), get().readAt);
    const route = routeOrNull(get(), id);
    if (get().conversations.find((c) => c.id === id)?.markedUnread) markOnNetwork(route, false);

    if (!useAppearanceStore.getState().readReceipts) return;
    if (isLocalConversation(id)) return;
    route?.session.sendReadReceipt?.(route.nativeId).catch(() => {});
  },

  async setTyping(id, typing) {
    if (!useAppearanceStore.getState().typingIndicators) return;
    const route = routeOrNull(get(), id);
    if (route?.session.setTyping) await route.session.setTyping(route.nativeId, typing);
  },

  watchPresence(id) {
    const route = routeOrNull(get(), id);
    return route?.session.watchPresence?.(route.nativeId) ?? (() => {});
  },

  async markUnread(id) {
    set((state) => ({ readAt: { ...state.readAt, [id]: MARKED_UNREAD } }));
    await writeReadState(requireAccountStorage(get()), get().readAt);
    markOnNetwork(routeOrNull(get(), id), true);
  },

  async setConsent(id, consent) {
    const route = routeOrNull(get(), id);
    if (!route?.session.setConsent) {
      throw new Error('This network has no way to refuse a conversation.');
    }

    const before = get().conversations;
    set({
      conversations: before.map((c) => (c.id === id ? { ...c, consent } : c)),
    });

    try {
      await route.session.setConsent(route.nativeId, consent);
    } catch (error) {
      set({ conversations: before });
      throw error;
    }
  },

  ingestMessage(message: ChatMessage) {
    set((state) => {
      const id = message.conversationId;
      const raw = state.rawMessages[id] ?? state.messages[id];
      const loaded = raw === undefined ? {} : withRaw(state, id, withMessage(raw, message));

      const touchesPreview = message.content.kind !== 'reaction';

      const indexed = indexMessages(state.mediaIndex, id, [message]);
      if (indexed !== state.mediaIndex && state.accountStorage) {
        saveMediaIndexSoon(state.accountStorage, indexed);
      }

      return {
        mediaIndex: indexed,
        ...loaded,
        conversations: touchesPreview
          ? withPreview(state.conversations, id, message)
          : state.conversations,
      };
    });
  },

  async react(conversationId, messageId, emoji) {
    const accountId = get().accountId;
    const store = requireMessageStore(get());
    const stored = get().messages[conversationId] ?? [];
    const target = stored.find((m) => m.id === messageId);

    const applyLocally = (reaction: ChatMessage) => {
      set((state) => {
        const list = state.rawMessages[conversationId] ?? state.messages[conversationId];
        return list === undefined ? {} : withRaw(state, conversationId, [...list, reaction]);
      });
    };

    if (isLocalConversation(conversationId)) {
      const action = hasReacted(target ?? ({} as ChatMessage), emoji, 'me') ? 'removed' : 'added';
      const reaction = localReaction(conversationId, messageId, emoji, 'me', action);
      await store.insertMessage(reaction);
      if (get().accountId !== accountId || get().messageStore !== store) return;
      applyLocally(reaction);
      return;
    }

    const route = routeOrNull(get(), conversationId);
    if (!route) throw new Error('Not connected');

    const self = selfIdFor(get(), route.protocol);
    const action = hasReacted(target ?? ({} as ChatMessage), emoji, self) ? 'removed' : 'added';

    const reaction = localReaction(conversationId, messageId, emoji, self, action);
    applyLocally(reaction);
    try {
      await route.session.send(route.nativeId, {
        kind: 'reaction',
        targetId: messageId,
        emoji,
        action,
      });
    } catch (error) {
      if (sameSession(get(), accountId, route.protocol, route.session)) {
        get().removeMessages(conversationId, [reaction.id]);
      }
      throw error;
    }
  },

  ingestConversation(conversation: Conversation) {
    get().ingestConversations([conversation]);
  },

  ingestConversations(conversations: Conversation[]) {
    if (conversations.length === 0) return;
    const before = get();
    const latest = new Map(before.conversations.map((c) => [c.id, c]));
    const added = new Set<ConversationId>();
    let { drafts, readAt } = before;
    let changed = false;
    let reorder = false;
    for (const conversation of conversations) {
      const { id, draft } = conversation;
      const known = latest.get(id);
      if (draft !== undefined) {
        const adopted = draftSync.received(id, draft, drafts[id] ?? '');
        if (adopted !== undefined) drafts = withDraft(drafts, id, adopted);
      }
      const marked = networkMark(conversation, known, readAt[id]);
      if (marked !== undefined) readAt = { ...readAt, [id]: marked };
      if (known && sameValue(known, conversation)) continue;
      if (!known) added.add(id);
      latest.set(id, conversation);
      changed = true;
      reorder ||= !known || recency(known) !== recency(conversation);
    }
    if (!changed && drafts === before.drafts && readAt === before.readAt) return;
    const kept = before.conversations.map((c) => latest.get(c.id)!);
    const list = changed
      ? reorder
        ? sortConversations([...[...added].map((id) => latest.get(id)!), ...kept])
        : kept
      : before.conversations;
    set({ conversations: list, drafts, readAt });

    const storage = before.accountStorage;
    if (!storage) return;
    if (drafts !== before.drafts) saveDraftsSoon(storage, drafts);
    if (readAt !== before.readAt)
      writeReadState(storage, readAt).catch((error) =>
        console.warn('[chat] could not save read state', error)
      );
  },

  replacePending(conversationId, pendingId, status, sentId) {
    set((state) => {
      const raw = rawOf(state, conversationId);
      if (sentId && raw.some((m) => m.id === sentId)) {
        return withRaw(
          state,
          conversationId,
          raw.filter((m) => m.id !== pendingId)
        );
      }
      if (sentId) sentAs.set(sentId, pendingId);
      return withRaw(
        state,
        conversationId,
        raw.map((m) => (m.id === pendingId ? { ...m, status } : m))
      );
    });
  },
}));

interface Route {
  protocol: ProtocolId;
  nativeId: string;
  session: ChatSession;
}

function markOnNetwork(route: Route | null, unread: boolean): void {
  route?.session
    .setMarkedUnread?.(route.nativeId, unread)
    .catch((error) => console.warn('[chat] could not sync the unread mark', error));
}

/** Only a change on the network moves the mark, so an update sent before our own mark arrived does not undo it. */
function networkMark(
  incoming: Conversation,
  known: Conversation | undefined,
  readAt: number | undefined
): number | undefined {
  if (incoming.markedUnread && !known?.markedUnread && readAt !== MARKED_UNREAD)
    return MARKED_UNREAD;
  if (known?.markedUnread && !incoming.markedUnread && readAt === MARKED_UNREAD) return Date.now();
  return undefined;
}

function routeOrNull(state: ChatState, id: ConversationId): Route | null {
  const split = splitConversationId(id);
  if (!split) return null;

  const session = state.sessions[split.protocol];
  if (!session) return null;
  return { protocol: split.protocol, nativeId: split.nativeId, session };
}

function requireRoute(state: ChatState, id: ConversationId): Route {
  const route = routeOrNull(state, id);
  if (route) return route;

  const split = splitConversationId(id);
  if (split) {
    const connection = state.protocols[split.protocol];
    throw new NotConnectedError(
      split.protocol,
      connection?.error ? `${split.protocol} is not connected: ${connection.error}` : undefined
    );
  }
  throw new Error('Not connected to the network yet.');
}

type ChatArgs<K extends Capability> =
  CapabilityMethod<K> extends (id: ConversationId, ...rest: infer R) => unknown ? R : never;

function onChat<K extends Capability>(
  state: ChatState,
  id: ConversationId,
  key: K,
  ...rest: ChatArgs<K>
): ReturnType<CapabilityMethod<K>> {
  const route = requireRoute(state, id);
  const method = capability(route.session, key) as unknown as (
    nativeId: string,
    ...args: unknown[]
  ) => ReturnType<CapabilityMethod<K>>;
  return method(route.nativeId, ...rest);
}

function requireSendable(state: ChatState, id: ConversationId): void {
  if (state.conversations.find((conversation) => conversation.id === id)?.canSend === false) {
    throw new Error('You cannot send messages in this chat.');
  }
}

function requireSession(state: ChatState, protocol: ProtocolId): ChatSession {
  const session = state.sessions[protocol];
  if (!session) throw new NotConnectedError(protocol);
  return session;
}

type Getter = () => ChatState;

async function afterRoute(
  get: Getter,
  id: ConversationId,
  op: (route: Route) => Promise<void>
): Promise<void> {
  const accountId = get().accountId;
  const route = requireRoute(get(), id);
  await op(route);
  if (sameSession(get(), accountId, route.protocol, route.session))
    await get().refreshConversations();
}

async function startConversation(
  get: Getter,
  protocol: ProtocolId,
  create: (session: ChatSession) => Promise<Conversation>
): Promise<Conversation> {
  const accountId = get().accountId;
  const session = requireSession(get(), protocol);
  const conversation = namespaceConversation(protocol, await create(session));
  if (sameSession(get(), accountId, protocol, session)) get().ingestConversation(conversation);
  return conversation;
}

async function joinConversation(
  get: Getter,
  protocol: ProtocolId,
  join: (session: ChatSession) => Promise<Conversation | null>
): Promise<Conversation | null> {
  const accountId = get().accountId;
  const session = requireSession(get(), protocol);
  const joined = await join(session);
  if (!joined) return null;
  const conversation = namespaceConversation(protocol, joined);
  if (sameSession(get(), accountId, protocol, session)) get().ingestConversation(conversation);
  return conversation;
}

type MessageSlices = Pick<ChatState, 'messages' | 'rawMessages'>;

function rawOf(state: MessageSlices, id: ConversationId): ChatMessage[] {
  return state.rawMessages[id] ?? state.messages[id] ?? [];
}

function withRaw(state: MessageSlices, id: ConversationId, raw: ChatMessage[]): MessageSlices {
  return {
    rawMessages: { ...state.rawMessages, [id]: raw },
    messages: { ...state.messages, [id]: foldReactions(raw) },
  };
}

function requireMessageStore(state: ChatState): MessageStore {
  if (!state.messageStore) throw new Error('No account is active.');
  return state.messageStore;
}

function sameSession(
  state: ChatState,
  accountId: string | null,
  protocol: ProtocolId,
  session: ChatSession
): boolean {
  return state.accountId === accountId && state.sessions[protocol] === session;
}

function sameSessions(
  state: ChatState,
  accountId: string | null,
  entries: [string, ChatSession][]
): boolean {
  return (
    state.accountId === accountId &&
    entries.every(([id, session]) => state.sessions[id] === session)
  );
}

function requireAccountStorage(state: ChatState): AccountStorage {
  if (!state.accountStorage) throw new Error('No account is active.');
  return state.accountStorage;
}

async function loadMessagePage(
  state: ChatState,
  id: ConversationId,
  limit: number,
  loaded: ChatMessage[] = []
): Promise<ChatMessage[]> {
  const local = requireMessageStore(state).loadMessages(id, limit, loaded[0]);
  if (isLocalConversation(id)) return local;

  const route = routeOrNull(state, id);
  if (!route) return [];
  const before = loaded.find((message) => !message.privateToMe) ?? loaded[0];
  const [network, privateMessages] = await Promise.all([
    route.session.getMessages(route.nativeId, { limit, before }),
    local,
  ]);
  return dedupe([
    ...network.map((message) => namespaceMessage(route.protocol, message)),
    ...privateMessages,
  ]).slice(-limit);
}

function localReaction(
  conversationId: ConversationId,
  targetId: MessageId,
  emoji: string,
  senderId: ParticipantId,
  action: 'added' | 'removed'
): ChatMessage {
  return {
    id: `reaction:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    conversationId,
    senderId,
    sentAt: Date.now(),
    content: { kind: 'reaction', targetId, emoji, action },
    fromMe: true,
    status: 'sent',
  };
}

type Setter = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void;

function setProtocol(set: Setter, protocol: ProtocolId, connection: ProtocolConnection): void {
  set((state) => ({ protocols: { ...state.protocols, [protocol]: connection } }));
}

function mergePage(loaded: ChatMessage[], page: ChatMessage[]): ChatMessage[] {
  const oldest = page[0];
  if (!oldest) return loaded;
  const known = new Map(loaded.map((message) => [message.id, message]));
  return dedupe([
    ...loaded.filter(
      (message) => message.sentAt < oldest.sentAt || message.id.startsWith('pending:')
    ),
    ...page.map((message) => {
      const same = known.get(message.id);
      return same && sameValue(same, message) ? same : message;
    }),
  ]);
}

function withMessage(raw: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const rest = removeMatchingPending(raw, message);
  const newest = rest.at(-1);
  if (!newest || (message.sentAt >= newest.sentAt && !rest.some((m) => m.id === message.id))) {
    return [...rest, message];
  }
  return dedupe([...rest, message]);
}

function dedupe(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

// A network hands media back with its own file, so a sent message is matched to its echo by id.
const sentAs = new Map<MessageId, string>();

function removeMatchingPending(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (!incoming.fromMe) return messages;
  const pendingId = sentAs.get(incoming.id);
  if (pendingId) {
    sentAs.delete(incoming.id);
    return messages.filter((message) => message.id !== pendingId);
  }
  const content = JSON.stringify(incoming.content);
  const index = messages.findIndex(
    (message) =>
      message.id.startsWith('pending:') &&
      message.status !== 'failed' &&
      message.threadRoot === incoming.threadRoot &&
      message.replyTo === incoming.replyTo &&
      JSON.stringify(message.content) === content
  );
  if (index === -1) return messages;
  return [...messages.slice(0, index), ...messages.slice(index + 1)];
}

function withPreview(
  conversations: Conversation[],
  id: ConversationId,
  message: ChatMessage
): Conversation[] {
  const index = conversations.findIndex((c) => c.id === id);
  const current = conversations[index];
  const last = current?.lastMessage;
  if (!current || (last && last.id !== message.id && message.sentAt < last.sentAt)) {
    return conversations;
  }
  const next = [...conversations];
  next[index] = { ...current, lastMessage: message };
  return recency(current) === message.sentAt ? next : sortConversations(next);
}

function recency(conversation: Conversation): number {
  return conversation.lastMessage?.sentAt ?? conversation.createdAt;
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => recency(b) - recency(a));
}

export function selfIdFor(
  state: Pick<ChatState, 'sessions'>,
  protocol: string | undefined
): string {
  if (!protocol || protocol === LOCAL_PROTOCOL) return '';
  return state.sessions[protocol]?.self.participantId ?? '';
}

export function sessionFor(
  state: Pick<ChatState, 'sessions'>,
  id: ConversationId | undefined
): ChatSession | undefined {
  const route = id ? splitConversationId(id) : null;
  return route ? state.sessions[route.protocol] : undefined;
}

export function xmtpSessionFor(
  state: Pick<ChatState, 'sessions'>
): (ChatSession & Partial<XmtpCapabilities>) | null {
  return state.sessions[PRIMARY_PROTOCOL] ?? null;
}

export function projectAccount(storage: AccountStorage): void {
  useChatStore.setState({
    ...EMPTY_PROJECTION,
    accountId: storage.accountId,
    accountStorage: storage,
    messageStore: storage.messages,
  });
}

export function showCachedConversations(cached: Conversation[]): void {
  if (cached.length === 0) return;
  useChatStore.setState((state) => {
    const shown = new Set(state.conversations.map((conversation) => conversation.id));
    const added = cached.filter((conversation) => !shown.has(conversation.id));
    return { conversations: sortConversations([...state.conversations, ...added]) };
  });
}

export function dropConversations(ids: ConversationId[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  useChatStore.setState((state) => ({
    conversations: state.conversations.filter((conversation) => !gone.has(conversation.id)),
  }));
}

export function clearChatProjection(status: ConnectionStatus = 'idle'): void {
  useChatStore.setState({ ...EMPTY_PROJECTION, status });
}

export { namespacedId };
