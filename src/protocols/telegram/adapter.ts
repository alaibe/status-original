import type {
  ChatSession,
  GroupInfo,
  JoinRequest,
  LoginState,
  MentionCandidate,
  PublicChatPreview,
} from '@/core/messaging/protocol';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  GroupMember,
  MessageContent,
  MessageId,
  ParticipantId,
  SelfIdentity,
  Unsubscribe,
} from '@/core/messaging/types';
import { TdRequestError, type TdApi, type TdObject } from './api';
import { describeAuthError, describeCodeDelivery } from './auth-copy';
import { inMainList } from './chats';
import { chatSenderId, messageIdOf, supergroupChatId, tdMessageId } from './ids';
import { TdDirectory } from './directory';
import { draftMessage, draftText } from './drafts';
import { TelegramGroups } from './groups';
import type { TelegramHost } from './service-host';
import { TelegramJoining } from './joining';
import { TelegramMessages } from './messages';
import { CHAT_PATCHES, TypingTracker } from './updates';
import { Outbox } from './outbox';
import { type MappingContext, toMessage } from './mapping';
import { handleOf, nameOf } from './users';
import { localFileUri } from '@/storage/media';
import type {
  TdAuthorizationState,
  TdBasicGroup,
  TdChat,
  TdChats,
  TdFile,
  TdMessage,
  TdMessages,
  TdSender,
  TdSupergroup,
  TdUser,
} from './types';

export const TELEGRAM_PROTOCOL_ID = 'telegram';

export interface TdParameters {
  databaseDirectory: string;
  apiId: number;
  apiHash: string;
  /** Base64, as TDLib's JSON interface encodes bytes. */
  databaseEncryptionKey: string;
  deviceModel: string;
  systemVersion: string;
  applicationVersion: string;
}

export interface TelegramConnectOptions {
  createApi(): Promise<TdApi>;
  parameters: TdParameters;
}

const MAIN_LIST = { '@type': 'chatListMain' } as const;
const CHAT_PAGE = 100;
const MAX_CHAT_PAGES = 20;
const PHONE_HINT = 'The number your Telegram account uses, with the country code.';

/**
 * A Telegram user client over TDLib, which owns history, contacts and files
 * in its own database.
 */
export class TelegramSession implements ChatSession {
  readonly sendsVideo = true;
  private api!: TdApi;
  private unsubscribe: Unsubscribe | null = null;
  private me: TdUser | null = null;
  private login: LoginState | null = null;
  private loginErrorAfterRestart: string | undefined;
  private readonly loginListeners = new Set<(login: LoginState | null) => void>();
  private readonly messageListeners = new Set<(message: ChatMessage) => void>();
  private readonly deletedListeners = new Set<
    (id: ConversationId, messageIds: MessageId[]) => void
  >();
  private readonly conversationListeners = new Set<(conversation: Conversation) => void>();
  private readonly outbox = new Outbox();
  private readonly td = new TdDirectory(
    () => this.api,
    () => this.self.participantId
  );
  private readonly host: TelegramHost = {
    api: () => this.api,
    td: this.td,
    toConversation: (chat) => this.toConversation(chat),
    selfUserId: () => this.me?.id,
    toMessage: (raw, fetchMedia) => this.toMessage(raw, fetchMedia),
    refetch: (chatId, messageId) => this.refetch(chatId, messageId),
    emitMessage: (raw) => this.emitMessage(raw),
  };
  private readonly groups = new TelegramGroups(this.host);
  private readonly joining = new TelegramJoining(this.host, this.groups);
  private readonly messages = new TelegramMessages(this.host, this.outbox);
  private readonly awaitedFiles = new Map<number, { chatId: number; messageId: number }>();
  private readonly refetching = new Map<string, Promise<void>>();
  private readonly typing = new TypingTracker((chatId) => {
    const chat = this.td.chats.get(chatId);
    if (chat) void this.announce(chat);
  });
  private chatsLoaded: Promise<void> | null = null;
  private stopped = false;

  private constructor(private readonly options: TelegramConnectOptions) {}

  static async connect(options: TelegramConnectOptions): Promise<TelegramSession> {
    const session = new TelegramSession(options);
    await session.start();
    return session;
  }

  get self(): SelfIdentity {
    return this.me
      ? { participantId: String(this.me.id), address: handleOf(this.me) }
      : { participantId: '', address: '' };
  }

  private async start(): Promise<void> {
    this.api = await this.options.createApi();
    this.unsubscribe = this.api.onUpdate((update) => {
      this.handleUpdate(update).catch(() => {});
    });
    const p = this.options.parameters;
    await this.api.send({
      '@type': 'setTdlibParameters',
      database_directory: p.databaseDirectory,
      use_file_database: true,
      use_chat_info_database: true,
      use_message_database: true,
      use_secret_chats: false,
      api_id: p.apiId,
      api_hash: p.apiHash,
      system_language_code: 'en',
      device_model: p.deviceModel,
      system_version: p.systemVersion,
      application_version: p.applicationVersion,
      database_encryption_key: p.databaseEncryptionKey,
    });
  }

  // ---- sign-in ----

  subscribeLogin(listener: (login: LoginState | null) => void): Unsubscribe {
    this.loginListeners.add(listener);
    listener(this.login);
    return () => this.loginListeners.delete(listener);
  }

  async submitLogin(value: string): Promise<void> {
    const current = this.login;
    if (!current) throw new Error('Telegram is not asking for anything right now.');

    const request: TdObject =
      current.step === 'phone'
        ? { '@type': 'setAuthenticationPhoneNumber', phone_number: value.trim() }
        : current.step === 'code'
          ? { '@type': 'checkAuthenticationCode', code: value.trim() }
          : { '@type': 'checkAuthenticationPassword', password: value };

    this.setLogin({ ...current, error: undefined });
    try {
      await this.api.send(request);
    } catch (error) {
      const message = describeAuthError(error);
      this.setLogin({ ...current, error: message });
      throw new Error(message);
    }
  }

  /** Ends the session on Telegram's side too; TDLib then wipes its database. */
  async signOut(): Promise<void> {
    await this.api.send({ '@type': 'logOut' });
  }

  private setLogin(login: LoginState | null): void {
    this.login = login;
    for (const listener of this.loginListeners) listener(login);
  }

  private async onAuthorizationState(state: TdAuthorizationState): Promise<void> {
    switch (state['@type']) {
      case 'authorizationStateWaitPhoneNumber': {
        this.me = null;
        const error = this.loginErrorAfterRestart;
        this.loginErrorAfterRestart = undefined;
        this.setLogin({ step: 'phone', hint: PHONE_HINT, error });
        return;
      }
      case 'authorizationStateWaitCode':
        this.setLogin({
          step: 'code',
          title: 'Enter the code',
          hint: describeCodeDelivery(state.code_info?.type['@type']),
        });
        return;
      case 'authorizationStateWaitPassword':
        this.setLogin({
          step: 'password',
          title: 'Two-step verification',
          hint: state.password_hint
            ? `Your two-step verification password. Hint: ${state.password_hint}`
            : 'Your two-step verification password.',
        });
        return;
      case 'authorizationStateReady':
        await this.onReady();
        return;
      case 'authorizationStateClosed':
        await this.onClosed();
        return;
      case 'authorizationStateWaitRegistration':
        await this.abandonLogin(
          'There is no Telegram account for that number. Create one in the Telegram app first.'
        );
        return;
      case 'authorizationStateWaitEmailAddress':
      case 'authorizationStateWaitEmailCode':
        await this.abandonLogin(
          'Telegram wants to verify this sign-in by email. Sign in once with the official app, then try again here.'
        );
        return;
      case 'authorizationStateWaitOtherDeviceConfirmation':
        await this.abandonLogin(
          'Telegram asked for a QR sign-in, which this app does not do. Try again.'
        );
        return;
      default:
        return;
    }
  }

  /** Nothing is stored before sign-in completes, so a bare destroy loses nothing. */
  private async abandonLogin(message: string): Promise<void> {
    this.loginErrorAfterRestart = message;
    await this.api.send({ '@type': 'destroy' }).catch(() => {});
  }

  private async onReady(): Promise<void> {
    this.me = await this.api.send<TdUser>({ '@type': 'getMe' });
    this.td.users.set(this.me.id, this.me);
    this.setLogin(null);
    await this.api
      .send({
        '@type': 'setOption',
        name: 'online',
        value: { '@type': 'optionValueBoolean', value: true },
      })
      .catch(() => {});
    this.chatsLoaded = null;
    await this.ensureChatsLoaded().catch(() => {});
  }

  /** TDLib closed on its own (sign-out); start over so the next sign-in can happen. */
  private async onClosed(): Promise<void> {
    this.outbox.rejectAll(new Error('Signed out of Telegram'));
    this.awaitedFiles.clear();
    this.typing.clear();
    this.td.clear();
    this.chatsLoaded = null;
    this.me = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.close();
    if (!this.stopped) await this.start();
  }

  // ---- updates ----

  private async handleUpdate(update: TdObject): Promise<void> {
    const patch = CHAT_PATCHES[update['@type']];
    if (patch) {
      const chat = this.td.chats.get(update.chat_id as number);
      if (!chat) return;
      patch(chat, update);
      return this.announce(chat);
    }
    switch (update['@type']) {
      case 'updateAuthorizationState':
        return this.onAuthorizationState(update.authorization_state as TdAuthorizationState);
      case 'updateUser': {
        const user = update.user as TdUser;
        this.td.users.set(user.id, user);
        return this.announceUserChats(user.id);
      }
      case 'updateUserStatus': {
        const id = update.user_id as number;
        const user = this.td.users.get(id);
        if (!user) return;
        user.status = update.status as TdUser['status'];
        return this.announceUserChats(id);
      }
      case 'updateChatAction': {
        const sender = update.sender_id as TdSender;
        if (sender['@type'] === 'messageSenderUser' && sender.user_id === this.me?.id) return;
        const chatId = update.chat_id as number;
        this.typing.set(chatId, (update.action as TdObject)['@type'] === 'chatActionTyping');
        const chat = this.td.chats.get(chatId);
        if (chat) await this.announce(chat);
        return;
      }
      case 'updateBasicGroup': {
        const group = update.basic_group as TdBasicGroup;
        this.td.basicGroups.set(group.id, group);
        const chat = this.td.chats.get(-group.id);
        if (chat) return this.announce(chat);
        return;
      }
      case 'updateSupergroup': {
        const group = update.supergroup as TdSupergroup;
        this.td.supergroups.set(group.id, group);
        const chat = this.td.chats.get(supergroupChatId(group.id));
        if (chat) return this.announce(chat);
        return;
      }
      case 'updateNewChat': {
        const chat = update.chat as TdChat;
        this.td.chats.set(chat.id, chat);
        return this.announce(chat);
      }
      case 'updateBasicGroupFullInfo':
        this.td.members.delete(-(update.basic_group_id as number));
        return;
      case 'updateSupergroupFullInfo':
        this.td.members.delete(supergroupChatId(update.supergroup_id as number));
        return;
      case 'updateNewMessage': {
        const message = update.message as TdMessage;
        // Our own sends surface through updateMessageSendSucceeded instead.
        if (message.sending_state) return;
        return this.emitMessage(message);
      }
      case 'updateMessageSendSucceeded': {
        const message = update.message as TdMessage;
        const oldId = update.old_message_id as number;
        this.outbox.resolve(oldId, message);
        return this.emitMessage(message);
      }
      case 'updateMessageSendFailed': {
        const oldId = update.old_message_id as number;
        const error = update.error as { message?: string } | undefined;
        this.outbox.reject(
          oldId,
          new Error(error?.message ?? 'Telegram did not accept the message')
        );
        return;
      }
      case 'updateMessageContent':
      case 'updateMessageEdited':
      case 'updateMessageInteractionInfo':
      case 'updateMessageIsPinned':
        return this.refetch(update.chat_id as number, update.message_id as number);
      case 'updateDeleteMessages': {
        if (!update.is_permanent || update.from_cache) return;
        const chatId = update.chat_id as number;
        const ids = (update.message_ids as number[]).map((id) => messageIdOf(chatId, id));
        for (const listener of this.deletedListeners) listener(String(chatId), ids);
        return;
      }
      case 'updateFile': {
        const file = update.file as TdFile;
        if (!file.local.is_downloading_completed) return;
        const awaited = this.awaitedFiles.get(file.id);
        if (!awaited) return;
        this.awaitedFiles.delete(file.id);
        return this.refetch(awaited.chatId, awaited.messageId);
      }
      default:
        return;
    }
  }

  private async announce(chat: TdChat): Promise<void> {
    if (this.conversationListeners.size === 0 || !this.included(chat) || !inMainList(chat)) return;
    const conversation = await this.toConversation(chat);
    for (const listener of this.conversationListeners) listener(conversation);
  }

  private async announceUserChats(userId: number): Promise<void> {
    for (const chat of this.td.chats.values()) {
      if (chat.type['@type'] === 'chatTypePrivate' && chat.type.user_id === userId)
        await this.announce(chat);
    }
  }

  private async emitMessage(raw: TdMessage): Promise<void> {
    if (this.messageListeners.size === 0) return;
    const chat = await this.td.requireChat(raw.chat_id);
    if (!this.included(chat)) return;
    const message = this.toMessage(raw, true);
    for (const listener of this.messageListeners) listener(message);
  }

  /** An edit arrives as two updates, content then edit date; they share one fetch. */
  private refetch(chatId: number, messageId: number): Promise<void> {
    if (this.messageListeners.size === 0) return Promise.resolve();
    const key = messageIdOf(chatId, messageId);
    let pending = this.refetching.get(key);
    if (!pending) {
      pending = this.api
        .send<TdMessage>({ '@type': 'getMessage', chat_id: chatId, message_id: messageId })
        .then((message) => this.emitMessage(message))
        .catch(() => {})
        .finally(() => this.refetching.delete(key));
      this.refetching.set(key, pending);
    }
    return pending;
  }

  // ---- ChatSession ----

  async listConversations(): Promise<Conversation[]> {
    if (!this.me) return [];
    await this.ensureChatsLoaded();
    const { chat_ids } = await this.api.send<TdChats>({
      '@type': 'getChats',
      chat_list: MAIN_LIST,
      limit: CHAT_PAGE * MAX_CHAT_PAGES,
    });
    const chats = chat_ids
      .map((id) => this.td.chats.get(id))
      .filter((chat): chat is TdChat => chat !== undefined && this.included(chat));
    return Promise.all(chats.map((chat) => this.toConversation(chat)));
  }

  async getMessages(
    id: ConversationId,
    opts?: { limit?: number; before?: { sentAt: number; id: MessageId } }
  ): Promise<ChatMessage[]> {
    if (!this.me) return [];
    const chatId = Number(id);
    const limit = opts?.limit ?? 50;
    const boundary = opts?.before ? tdMessageId(opts.before.id) : 0;
    let from = boundary;
    const collected: TdMessage[] = [];

    // TDLib may answer with fewer messages than asked for, one at a time from
    // the server, so keep paging until the request is satisfied or history ends.
    while (collected.length < limit) {
      const { messages } = await this.api.send<TdMessages>({
        '@type': 'getChatHistory',
        chat_id: chatId,
        from_message_id: from,
        offset: 0,
        limit: Math.min(100, limit - collected.length),
        only_local: false,
      });
      const page = messages.filter(
        (m): m is TdMessage => m !== null && (boundary === 0 || m.id < boundary)
      );
      if (page.length === 0) break;
      collected.push(...page);
      from = page[page.length - 1].id;
    }

    return collected.map((m) => this.toMessage(m, true)).reverse();
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    let value = addressOrId.trim();
    const link = value.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)\/?$/);
    if (link) value = `@${link[1]}`;

    if (value.startsWith('@') || /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(value)) {
      const chat = await this.api
        .send<TdChat>({ '@type': 'searchPublicChat', username: value.replace(/^@/, '') })
        .catch(() => null);
      if (!chat) return null;
      this.td.chats.set(chat.id, chat);
      return chat.type['@type'] === 'chatTypePrivate' ? String(chat.type.user_id) : null;
    }

    if (/^\+?\d{5,}$/.test(value)) {
      if (!value.startsWith('+')) {
        const user = await this.api
          .send<TdUser>({ '@type': 'getUser', user_id: Number(value) })
          .catch(() => null);
        if (user) return String(user.id);
      }
      const user = await this.api
        .send<TdUser>({ '@type': 'searchUserByPhoneNumber', phone_number: value })
        .catch(() => null);
      return user ? String(user.id) : null;
    }

    return null;
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const user = await this.td.userFor(id);
      if (user) out[id] = handleOf(user);
    }
    return out;
  }

  async resolveNames(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const user = await this.td.userFor(id);
      if (user) {
        out[id] = nameOf(user);
        continue;
      }
      const chatId = chatSenderId(id);
      if (chatId !== null) {
        const chat = await this.td.requireChat(chatId).catch(() => null);
        if (chat) out[id] = chat.title;
      }
    }
    return out;
  }

  async createDm(peer: ParticipantId): Promise<Conversation> {
    const chat = await this.api.send<TdChat>({
      '@type': 'createPrivateChat',
      user_id: Number(peer),
      force: false,
    });
    this.td.chats.set(chat.id, chat);
    return this.toConversation(chat);
  }

  createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    return this.groups.createGroup(peers, title);
  }

  getMembers(id: ConversationId): Promise<GroupMember[]> {
    return this.groups.getMembers(id);
  }

  mentionCandidates(id: ConversationId, query: string): Promise<MentionCandidate[]> {
    return this.groups.mentionCandidates(id, query);
  }

  getGroupInfo(id: ConversationId): Promise<GroupInfo> {
    return this.groups.getGroupInfo(id);
  }

  setSlowModeDelay(id: ConversationId, seconds: number): Promise<void> {
    return this.groups.setSlowModeDelay(id, seconds);
  }

  addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    return this.groups.addMembers(id, peers);
  }

  removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    return this.groups.removeMembers(id, peers);
  }

  banMember(id: ConversationId, peer: ParticipantId): Promise<void> {
    return this.groups.banMember(id, peer);
  }

  setMemberMuted(id: ConversationId, peer: ParticipantId, muted: boolean): Promise<void> {
    return this.groups.setMemberMuted(id, peer, muted);
  }

  renameGroup(id: ConversationId, title: string): Promise<void> {
    return this.groups.renameGroup(id, title);
  }

  leaveGroup(id: ConversationId): Promise<void> {
    return this.groups.leaveGroup(id);
  }

  previewPublicChat(usernameOrLink: string): Promise<PublicChatPreview> {
    return this.joining.previewPublicChat(usernameOrLink);
  }

  joinPublicChat(id: ConversationId): Promise<Conversation | null> {
    return this.joining.joinPublicChat(id);
  }

  createInviteLink(id: ConversationId, requiresApproval: boolean): Promise<string> {
    return this.joining.createInviteLink(id, requiresApproval);
  }

  getJoinRequests(id: ConversationId): Promise<JoinRequest[]> {
    return this.joining.getJoinRequests(id);
  }

  processJoinRequest(id: ConversationId, userId: ParticipantId, approve: boolean): Promise<void> {
    return this.joining.processJoinRequest(id, userId, approve);
  }

  send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    return this.messages.send(id, content, replyTo);
  }

  editMessage(id: ConversationId, messageId: MessageId, text: string): Promise<void> {
    return this.messages.editMessage(id, messageId, text);
  }

  deleteMessage(id: ConversationId, messageId: MessageId): Promise<void> {
    return this.messages.deleteMessage(id, messageId);
  }

  deleteMessageForMe(id: ConversationId, messageId: MessageId): Promise<void> {
    return this.messages.deleteMessageForMe(id, messageId);
  }

  votePoll(id: ConversationId, messageId: MessageId, optionIds: number[]): Promise<void> {
    return this.messages.votePoll(id, messageId, optionIds);
  }

  createPoll(id: ConversationId, question: string, options: string[]): Promise<void> {
    return this.messages.createPoll(id, question, options);
  }

  listPinnedMessages(id: ConversationId): Promise<ChatMessage[]> {
    return this.messages.listPinnedMessages(id);
  }

  searchMessages(query: string, id?: ConversationId): Promise<ChatMessage[]> {
    return this.messages.searchMessages(query, id);
  }

  setMessagePinned(id: ConversationId, messageId: MessageId, pinned: boolean): Promise<void> {
    return this.messages.setMessagePinned(id, messageId, pinned);
  }

  async streamDeletedMessages(
    listener: (id: ConversationId, messageIds: MessageId[]) => void
  ): Promise<Unsubscribe> {
    this.deletedListeners.add(listener);
    return () => this.deletedListeners.delete(listener);
  }

  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const chat = await this.td.requireChat(Number(id));
    if (chat.type['@type'] !== 'chatTypePrivate') return;
    await this.api.send({
      '@type': 'setMessageSenderBlockList',
      sender_id: { '@type': 'messageSenderUser', user_id: chat.type.user_id },
      block_list: consent === 'denied' ? { '@type': 'blockListMain' } : null,
    });
  }

  async sendReadReceipt(id: ConversationId): Promise<void> {
    const chat = this.td.chats.get(Number(id));
    if (!chat?.last_message) return;
    await this.api.send({
      '@type': 'viewMessages',
      chat_id: chat.id,
      message_ids: [chat.last_message.id],
      force_read: true,
    });
  }

  async saveDraft(id: ConversationId, text: string): Promise<void> {
    await this.api.send({
      '@type': 'setChatDraftMessage',
      chat_id: Number(id),
      topic_id: null,
      draft_message: text ? draftMessage(text) : null,
    });
  }

  async setMarkedUnread(id: ConversationId, unread: boolean): Promise<void> {
    await this.api.send({
      '@type': 'toggleChatIsMarkedAsUnread',
      chat_id: Number(id),
      is_marked_as_unread: unread,
    });
  }

  async setTyping(id: ConversationId, typing: boolean): Promise<void> {
    await this.api.send({
      '@type': 'sendChatAction',
      chat_id: Number(id),
      topic_id: null,
      business_connection_id: '',
      action: { '@type': typing ? 'chatActionTyping' : 'chatActionCancel' },
    });
  }

  async sync(): Promise<void> {
    if (!this.me) return;
    this.chatsLoaded = null;
    await this.ensureChatsLoaded();
  }

  async streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe> {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  async streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe> {
    this.conversationListeners.add(onConversation);
    // Chats TDLib pushed before anyone was listening.
    for (const chat of this.td.chats.values()) {
      if (this.included(chat) && inMainList(chat)) {
        void this.toConversation(chat).then((conversation) => {
          if (this.conversationListeners.has(onConversation)) onConversation(conversation);
        });
      }
    }
    return () => this.conversationListeners.delete(onConversation);
  }

  async disconnect(): Promise<void> {
    this.stop();
    await this.api.close();
  }

  async eraseLocalDatabase(): Promise<void> {
    this.stop();
    await this.api.destroy();
  }

  private stop(): void {
    this.stopped = true;
    this.typing.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ---- mapping ----

  private included(chat: TdChat): boolean {
    return chat.type['@type'] !== 'chatTypeSecret';
  }

  private ensureChatsLoaded(): Promise<void> {
    this.chatsLoaded ??= this.loadAllChats().catch((error) => {
      this.chatsLoaded = null;
      throw error;
    });
    return this.chatsLoaded;
  }

  private async loadAllChats(): Promise<void> {
    for (let page = 0; page < MAX_CHAT_PAGES; page++) {
      try {
        await this.api.send({ '@type': 'loadChats', chat_list: MAIN_LIST, limit: CHAT_PAGE });
      } catch (error) {
        // 404 is TDLib for "nothing left to load".
        if (error instanceof TdRequestError && error.code === 404) return;
        throw error;
      }
    }
  }

  private async toConversation(chat: TdChat): Promise<Conversation> {
    const selfId = this.self.participantId;
    const isDm = chat.type['@type'] === 'chatTypePrivate';
    const isChannel = chat.type['@type'] === 'chatTypeSupergroup' && chat.type.is_channel;
    const memberIds = isChannel
      ? [selfId]
      : isDm
        ? [...new Set([String((chat.type as { user_id: number }).user_id), selfId])]
        : (await this.td.membersOf(chat)).map((member) => member.id);
    const peer =
      chat.type['@type'] === 'chatTypePrivate' ? this.td.users.get(chat.type.user_id) : undefined;

    return {
      id: String(chat.id),
      kind: isDm ? 'dm' : isChannel ? 'channel' : 'group',
      title: chat.title,
      memberIds,
      createdAt: chat.last_message ? chat.last_message.date * 1000 : 0,
      lastMessage: chat.last_message ? this.toMessage(chat.last_message, false) : undefined,
      unreadCount: chat.unread_count,
      mentionCount: chat.unread_mention_count,
      ...(chat.is_marked_as_unread ? { markedUnread: true } : {}),
      draft: draftText(chat.draft_message),
      ...(chat.pending_join_requests?.total_count
        ? { pendingJoinRequests: chat.pending_join_requests.total_count }
        : {}),
      canSend: this.td.canSend(chat),
      typing: this.typing.isTyping(chat.id),
      online: peer?.status?.['@type'] === 'userStatusOnline',
      lastSeenAt:
        peer?.status?.['@type'] === 'userStatusOffline' && peer.status.was_online
          ? peer.status.was_online * 1000
          : undefined,
      consent: chat.block_list ? 'denied' : 'allowed',
      selfRole: isDm ? undefined : this.td.roleIn(chat),
      ...this.td.rightsIn(chat),
    };
  }

  private mapping(raw: TdMessage, fetchMedia: boolean): MappingContext {
    return {
      selfId: this.me ? String(this.me.id) : undefined,
      media: (file) => this.localUri(raw, file, fetchMedia),
      names: (userIds) => this.td.namesOf(userIds),
    };
  }

  private toMessage(raw: TdMessage, fetchMedia: boolean): ChatMessage {
    return toMessage(raw, this.mapping(raw, fetchMedia));
  }

  /**
   * TDLib downloads on request. A file that is not local yet renders as a
   * placeholder, and the message is re-emitted once `updateFile` says it is.
   */
  private localUri(raw: TdMessage, file: TdFile, fetchMedia: boolean): string | null {
    if (file.local.is_downloading_completed && file.local.path)
      return localFileUri(file.local.path);
    if (!fetchMedia) return null;
    if (!this.awaitedFiles.has(file.id)) {
      this.awaitedFiles.set(file.id, { chatId: raw.chat_id, messageId: raw.id });
      this.api
        .send<TdFile>({
          '@type': 'downloadFile',
          file_id: file.id,
          priority: 16,
          offset: 0,
          limit: 0,
          synchronous: false,
        })
        .then((started) => {
          if (started.local.is_downloading_completed) {
            this.awaitedFiles.delete(file.id);
            return this.refetch(raw.chat_id, raw.id);
          }
        })
        .catch(() => this.awaitedFiles.delete(file.id));
    }
    return null;
  }
}
