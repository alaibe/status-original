import type { ChatSession, LoginState } from '@/core/messaging/protocol';
import type {
  ChatMessage,
  Conversation,
  ConversationId,
  GroupMember,
  GroupRole,
  MessageContent,
  MessageId,
  ParticipantId,
  SelfIdentity,
  Unsubscribe,
} from '@/core/messaging/types';
import { TdRequestError, type TdApi, type TdObject } from './api';
import { formattedToMarkdown, markdownToFormatted } from './formatting';
import { localFileUri, pathOfFileUri } from '@/storage/media';
import type {
  TdAuthorizationState,
  TdBasicGroup,
  TdBasicGroupFullInfo,
  TdChat,
  TdChatMember,
  TdChatMembers,
  TdChatPosition,
  TdChats,
  TdFile,
  TdFormattedText,
  TdMemberStatus,
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
const MEMBER_PAGE = 200;
const SEND_TIMEOUT_MS = 30_000;
const PHONE_HINT = 'The number your Telegram account uses, with the country code.';

interface PendingSend {
  resolve(message: TdMessage): void;
  reject(error: Error): void;
}

/**
 * A Telegram user client over TDLib, which owns history, contacts and files
 * in its own database. Only private chats and groups are surfaced: channels
 * are broadcasts, not conversations.
 */
export class TelegramSession implements ChatSession {
  private api!: TdApi;
  private unsubscribe: Unsubscribe | null = null;
  private me: TdUser | null = null;
  private login: LoginState | null = null;
  private loginErrorAfterRestart: string | undefined;
  private readonly loginListeners = new Set<(login: LoginState | null) => void>();
  private readonly messageListeners = new Set<(message: ChatMessage) => void>();
  private readonly conversationListeners = new Set<(conversation: Conversation) => void>();
  private readonly chats = new Map<number, TdChat>();
  private readonly users = new Map<number, TdUser>();
  private readonly basicGroups = new Map<number, TdBasicGroup>();
  private readonly supergroups = new Map<number, TdSupergroup>();
  private readonly members = new Map<number, Promise<GroupMember[]>>();
  private readonly pendingSends = new Map<number, PendingSend>();
  private readonly awaitedFiles = new Map<number, { chatId: number; messageId: number }>();
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
    this.users.set(this.me.id, this.me);
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
    for (const pending of this.pendingSends.values())
      pending.reject(new Error('Signed out of Telegram'));
    this.pendingSends.clear();
    this.awaitedFiles.clear();
    this.chats.clear();
    this.users.clear();
    this.basicGroups.clear();
    this.supergroups.clear();
    this.members.clear();
    this.chatsLoaded = null;
    this.me = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.close();
    if (!this.stopped) await this.start();
  }

  // ---- updates ----

  private async handleUpdate(update: TdObject): Promise<void> {
    switch (update['@type']) {
      case 'updateAuthorizationState':
        return this.onAuthorizationState(update.authorization_state as TdAuthorizationState);
      case 'updateUser': {
        const user = update.user as TdUser;
        this.users.set(user.id, user);
        return;
      }
      case 'updateBasicGroup': {
        const group = update.basic_group as TdBasicGroup;
        this.basicGroups.set(group.id, group);
        return;
      }
      case 'updateSupergroup': {
        const group = update.supergroup as TdSupergroup;
        this.supergroups.set(group.id, group);
        return;
      }
      case 'updateNewChat': {
        const chat = update.chat as TdChat;
        this.chats.set(chat.id, chat);
        return this.announce(chat);
      }
      case 'updateChatPosition': {
        const chat = this.chats.get(update.chat_id as number);
        if (!chat) return;
        chat.positions = withPosition(chat.positions, update.position as TdChatPosition);
        return this.announce(chat);
      }
      case 'updateChatTitle': {
        const chat = this.chats.get(update.chat_id as number);
        if (!chat) return;
        chat.title = update.title as string;
        return this.announce(chat);
      }
      case 'updateChatLastMessage': {
        const chat = this.chats.get(update.chat_id as number);
        if (!chat) return;
        chat.last_message = (update.last_message as TdMessage | null) ?? undefined;
        chat.positions = update.positions as TdChatPosition[];
        return this.announce(chat);
      }
      case 'updateChatBlockList': {
        const chat = this.chats.get(update.chat_id as number);
        if (!chat) return;
        chat.block_list = update.block_list as TdObject | null;
        return this.announce(chat);
      }
      case 'updateBasicGroupFullInfo':
        this.members.delete(-(update.basic_group_id as number));
        return;
      case 'updateSupergroupFullInfo':
        this.members.delete(supergroupChatId(update.supergroup_id as number));
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
        this.pendingSends.get(oldId)?.resolve(message);
        this.pendingSends.delete(oldId);
        return this.emitMessage(message);
      }
      case 'updateMessageSendFailed': {
        const oldId = update.old_message_id as number;
        const error = update.error as { message?: string } | undefined;
        this.pendingSends
          .get(oldId)
          ?.reject(new Error(error?.message ?? 'Telegram did not accept the message'));
        this.pendingSends.delete(oldId);
        return;
      }
      case 'updateMessageContent':
      case 'updateMessageInteractionInfo':
        return this.refetch(update.chat_id as number, update.message_id as number);
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

  private async emitMessage(raw: TdMessage): Promise<void> {
    if (this.messageListeners.size === 0) return;
    const chat = await this.requireChat(raw.chat_id);
    if (!this.included(chat)) return;
    const message = this.toMessage(raw, true);
    for (const listener of this.messageListeners) listener(message);
  }

  private async refetch(chatId: number, messageId: number): Promise<void> {
    if (this.messageListeners.size === 0) return;
    const message = await this.api
      .send<TdMessage>({ '@type': 'getMessage', chat_id: chatId, message_id: messageId })
      .catch(() => null);
    if (message) await this.emitMessage(message);
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
      .map((id) => this.chats.get(id))
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
      this.chats.set(chat.id, chat);
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
      const user = await this.userFor(id);
      if (user) out[id] = handleOf(user);
    }
    return out;
  }

  async resolveNames(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const user = await this.userFor(id);
      if (user) {
        out[id] = nameOf(user);
        continue;
      }
      const chatId = chatSenderId(id);
      if (chatId !== null) {
        const chat = await this.requireChat(chatId).catch(() => null);
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
    this.chats.set(chat.id, chat);
    return this.toConversation(chat);
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    const created = await this.api.send<TdObject>({
      '@type': 'createNewBasicGroupChat',
      user_ids: peers.map(Number),
      title,
    });
    const chatId =
      created['@type'] === 'chat' ? (created as TdChat).id : (created.chat_id as number);
    return this.toConversation(await this.requireChat(chatId));
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    return this.membersOf(await this.requireChat(Number(id)));
  }

  async addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    await this.api.send({
      '@type': 'addChatMembers',
      chat_id: Number(id),
      user_ids: peers.map(Number),
    });
    this.members.delete(Number(id));
  }

  async removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    for (const peer of peers) {
      await this.api.send({
        '@type': 'setChatMemberStatus',
        chat_id: Number(id),
        member_id: { '@type': 'messageSenderUser', user_id: Number(peer) },
        status: { '@type': 'chatMemberStatusLeft' },
      });
    }
    this.members.delete(Number(id));
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    await this.api.send({ '@type': 'setChatTitle', chat_id: Number(id), title });
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    await this.api.send({ '@type': 'leaveChat', chat_id: Number(id) });
  }

  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    const chatId = Number(id);

    if (content.kind === 'reaction') {
      const reaction = { '@type': 'reactionTypeEmoji', emoji: content.emoji };
      await this.api.send(
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
    const sent = await this.api.send<TdMessage>(request);
    const final = await this.awaitSent(sent);
    return messageIdOf(chatId, final.id);
  }

  /**
   * TDLib answers sendMessage with a placeholder id and reports the real one
   * later. Waiting for it turns a rejected send into a failed message instead
   * of a phantom one; if the network is slow the placeholder is good enough.
   */
  private awaitSent(sent: TdMessage): Promise<TdMessage> {
    if (!sent.sending_state) return Promise.resolve(sent);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSends.delete(sent.id);
        resolve(sent);
      }, SEND_TIMEOUT_MS);
      this.pendingSends.set(sent.id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const chat = await this.requireChat(Number(id));
    if (chat.type['@type'] !== 'chatTypePrivate') return;
    await this.api.send({
      '@type': 'setMessageSenderBlockList',
      sender_id: { '@type': 'messageSenderUser', user_id: chat.type.user_id },
      block_list: consent === 'denied' ? { '@type': 'blockListMain' } : null,
    });
  }

  async sendReadReceipt(id: ConversationId): Promise<void> {
    const chat = this.chats.get(Number(id));
    if (!chat?.last_message) return;
    await this.api.send({
      '@type': 'viewMessages',
      chat_id: chat.id,
      message_ids: [chat.last_message.id],
      force_read: true,
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
    for (const chat of this.chats.values()) {
      if (this.included(chat) && inMainList(chat)) {
        void this.toConversation(chat).then((conversation) => {
          if (this.conversationListeners.has(onConversation)) onConversation(conversation);
        });
      }
    }
    return () => this.conversationListeners.delete(onConversation);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.close();
  }

  async eraseLocalDatabase(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.destroy();
  }

  // ---- mapping ----

  private included(chat: TdChat): boolean {
    const type = chat.type;
    if (type['@type'] === 'chatTypePrivate') return true;
    if (type['@type'] === 'chatTypeBasicGroup') return true;
    if (type['@type'] === 'chatTypeSupergroup') {
      return !(type.is_channel || this.supergroups.get(type.supergroup_id)?.is_channel);
    }
    return false;
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

  private async requireChat(chatId: number): Promise<TdChat> {
    const cached = this.chats.get(chatId);
    if (cached) return cached;
    const chat = await this.api.send<TdChat>({ '@type': 'getChat', chat_id: chatId });
    this.chats.set(chat.id, chat);
    return chat;
  }

  private async userFor(id: ParticipantId): Promise<TdUser | null> {
    if (!/^\d+$/.test(id)) return null;
    const cached = this.users.get(Number(id));
    if (cached) return cached;
    const user = await this.api
      .send<TdUser>({ '@type': 'getUser', user_id: Number(id) })
      .catch(() => null);
    if (user?.['@type'] !== 'user') return null;
    this.users.set(user.id, user);
    return user;
  }

  private async toConversation(chat: TdChat): Promise<Conversation> {
    const selfId = this.self.participantId;
    const isDm = chat.type['@type'] === 'chatTypePrivate';
    const memberIds = isDm
      ? [...new Set([String((chat.type as { user_id: number }).user_id), selfId])]
      : (await this.membersOf(chat)).map((member) => member.id);

    return {
      id: String(chat.id),
      kind: isDm ? 'dm' : 'group',
      title: chat.title,
      memberIds,
      createdAt: chat.last_message ? chat.last_message.date * 1000 : 0,
      lastMessage: chat.last_message ? this.toMessage(chat.last_message, false) : undefined,
      consent: chat.block_list ? 'denied' : 'allowed',
      selfRole: isDm ? undefined : this.roleIn(chat),
    };
  }

  private roleIn(chat: TdChat): GroupRole {
    const type = chat.type;
    const status =
      type['@type'] === 'chatTypeBasicGroup'
        ? this.basicGroups.get(type.basic_group_id)?.status['@type']
        : type['@type'] === 'chatTypeSupergroup'
          ? this.supergroups.get(type.supergroup_id)?.status['@type']
          : undefined;
    return mapRole(status);
  }

  private membersOf(chat: TdChat): Promise<GroupMember[]> {
    let pending = this.members.get(chat.id);
    if (!pending) {
      pending = this.fetchMembers(chat).catch(() => [
        { id: this.self.participantId, role: 'member' as const },
      ]);
      this.members.set(chat.id, pending);
    }
    return pending;
  }

  private async fetchMembers(chat: TdChat): Promise<GroupMember[]> {
    const type = chat.type;
    let raw: TdChatMember[];
    if (type['@type'] === 'chatTypeBasicGroup') {
      const info = await this.api.send<TdBasicGroupFullInfo>({
        '@type': 'getBasicGroupFullInfo',
        basic_group_id: type.basic_group_id,
      });
      raw = info.members;
    } else if (type['@type'] === 'chatTypeSupergroup') {
      const page = await this.api.send<TdChatMembers>({
        '@type': 'getSupergroupMembers',
        supergroup_id: type.supergroup_id,
        offset: 0,
        limit: MEMBER_PAGE,
      });
      raw = page.members;
    } else if (type['@type'] === 'chatTypePrivate') {
      return [
        { id: String(type.user_id), role: 'member' },
        { id: this.self.participantId, role: 'member' },
      ];
    } else {
      return [];
    }
    return raw
      .filter(
        (member) =>
          !['chatMemberStatusLeft', 'chatMemberStatusBanned'].includes(member.status['@type'])
      )
      .map((member) => ({
        id: senderIdOf(member.member_id),
        role: mapRole(member.status['@type']),
      }));
  }

  private toMessage(raw: TdMessage, fetchMedia: boolean): ChatMessage {
    const replyTo =
      raw.reply_to?.['@type'] === 'messageReplyToMessage' &&
      (raw.reply_to as { chat_id: number }).chat_id === raw.chat_id
        ? messageIdOf(raw.chat_id, (raw.reply_to as { message_id: number }).message_id)
        : undefined;
    const reactions = this.reactionsOf(raw);
    return {
      id: messageIdOf(raw.chat_id, raw.id),
      conversationId: String(raw.chat_id),
      senderId: senderIdOf(raw.sender_id),
      sentAt: raw.date * 1000,
      content: this.toContent(raw, fetchMedia),
      fromMe: raw.is_outgoing,
      status: !raw.sending_state
        ? 'sent'
        : raw.sending_state['@type'] === 'messageSendingStateFailed'
          ? 'failed'
          : 'sending',
      ...(replyTo ? { replyTo } : {}),
      ...(reactions ? { reactions } : {}),
      ...(raw.forward_info ? { forwarded: true } : {}),
    };
  }

  /** TDLib lists a few recent senders per emoji; that is what there is to show. */
  private reactionsOf(raw: TdMessage): Record<string, ParticipantId[]> | undefined {
    const list = raw.interaction_info?.reactions?.reactions;
    if (!list || list.length === 0) return undefined;
    const out: Record<string, ParticipantId[]> = {};
    for (const reaction of list) {
      if (reaction.type['@type'] !== 'reactionTypeEmoji') continue;
      const emoji = (reaction.type as { emoji: string }).emoji;
      const people = new Set(reaction.recent_sender_ids.map(senderIdOf));
      if (reaction.is_chosen && this.me) people.add(String(this.me.id));
      if (people.size > 0) out[emoji] = [...people];
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private toContent(raw: TdMessage, fetchMedia: boolean): MessageContent {
    const content = raw.content;
    const caption = content.caption
      ? formattedToMarkdown(content.caption as TdFormattedText).trim() || undefined
      : undefined;
    const withCaption = (label: string) => (caption ? `${label} · ${caption}` : label);

    switch (content['@type']) {
      case 'messageText':
        return { kind: 'text', text: formattedToMarkdown(content.text as TdFormattedText) };

      case 'messagePhoto': {
        const sizes = (
          content.photo as { sizes: { photo: TdFile; width: number; height: number }[] }
        ).sizes;
        const size = sizes[sizes.length - 1];
        const uri = size ? this.localUri(raw, size.photo, fetchMedia) : null;
        if (!uri)
          return { kind: 'unsupported', typeId: 'photo', fallback: withCaption('📷 Photo') };
        return {
          kind: 'image',
          uri,
          width: size.width,
          height: size.height,
          size: size.photo.size,
          ...(caption ? { caption } : {}),
        };
      }

      case 'messageDocument': {
        const document = content.document as {
          document: TdFile;
          file_name: string;
          mime_type: string;
        };
        const uri = this.localUri(raw, document.document, fetchMedia);
        if (!uri) {
          return {
            kind: 'unsupported',
            typeId: 'document',
            fallback: withCaption(`📎 ${document.file_name}`),
          };
        }
        return {
          kind: 'file',
          uri,
          name: document.file_name,
          mimeType: document.mime_type,
          size: document.document.size,
        };
      }

      case 'messageVoiceNote': {
        const voice = content.voice_note as { voice: TdFile; duration: number; mime_type: string };
        const uri = this.localUri(raw, voice.voice, fetchMedia);
        if (!uri) return { kind: 'unsupported', typeId: 'voice', fallback: '🎤 Voice message' };
        return {
          kind: 'voice',
          uri,
          durationMs: voice.duration * 1000,
          size: voice.voice.size,
          mimeType: voice.mime_type,
        };
      }

      case 'messageSticker': {
        const emoji = (content.sticker as { emoji?: string }).emoji;
        return {
          kind: 'unsupported',
          typeId: 'sticker',
          fallback: emoji ? `${emoji} Sticker` : 'Sticker',
        };
      }
      case 'messageAnimation':
        return { kind: 'unsupported', typeId: 'animation', fallback: withCaption('GIF') };
      case 'messageVideo':
        return { kind: 'unsupported', typeId: 'video', fallback: withCaption('🎬 Video') };
      case 'messageVideoNote':
        return { kind: 'unsupported', typeId: 'videoNote', fallback: '📹 Video message' };
      case 'messageAudio': {
        const audio = content.audio as { title?: string; file_name?: string };
        return {
          kind: 'unsupported',
          typeId: 'audio',
          fallback: withCaption(`🎵 ${audio.title || audio.file_name || 'Audio'}`),
        };
      }
      case 'messageLocation':
      case 'messageVenue':
        return { kind: 'unsupported', typeId: 'location', fallback: '📍 Location' };
      case 'messageContact': {
        const contact = content.contact as { first_name: string; last_name: string };
        return {
          kind: 'unsupported',
          typeId: 'contact',
          fallback: `👤 ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}`,
        };
      }
      case 'messagePoll':
        return {
          kind: 'unsupported',
          typeId: 'poll',
          fallback: `📊 ${(content.poll as { question: { text: string } }).question.text}`,
        };
      case 'messageDice':
        return {
          kind: 'unsupported',
          typeId: 'dice',
          fallback: `${content.emoji as string} ${content.value as number}`,
        };

      case 'messageChatAddMembers':
        return {
          kind: 'system',
          text: `${this.namesOf(content.member_user_ids as number[])} joined`,
        };
      case 'messageChatDeleteMember':
        return { kind: 'system', text: `${this.namesOf([content.user_id as number])} left` };
      case 'messageChatJoinByLink':
      case 'messageChatJoinByRequest':
        return { kind: 'system', text: `${this.namesOf([userIdOf(raw.sender_id)])} joined` };
      case 'messageChatChangeTitle':
        return { kind: 'system', text: `Renamed to "${content.title as string}"` };
      case 'messageChatChangePhoto':
        return { kind: 'system', text: 'Group photo changed' };
      case 'messageChatDeletePhoto':
        return { kind: 'system', text: 'Group photo removed' };
      case 'messageBasicGroupChatCreate':
      case 'messageSupergroupChatCreate':
        return { kind: 'system', text: 'Group created' };
      case 'messagePinMessage':
        return { kind: 'system', text: 'Message pinned' };
      case 'messageContactRegistered':
        return {
          kind: 'system',
          text: `${this.namesOf([userIdOf(raw.sender_id)])} joined Telegram`,
        };
      case 'messageChatUpgradeTo':
      case 'messageChatUpgradeFrom':
        return { kind: 'system', text: 'Group upgraded' };

      default:
        return { kind: 'unsupported', typeId: content['@type'], fallback: 'Unsupported message' };
    }
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

  private namesOf(userIds: number[]): string {
    return userIds
      .map((id) => {
        const user = this.users.get(id);
        return user ? nameOf(user) : String(id);
      })
      .join(', ');
  }
}

// ---- helpers ----

export function messageIdOf(chatId: number, messageId: number): MessageId {
  return `${chatId}_${messageId}`;
}

export function tdMessageId(id: MessageId): number {
  return Number(id.slice(id.lastIndexOf('_') + 1));
}

function senderIdOf(sender: TdSender): ParticipantId {
  return sender['@type'] === 'messageSenderUser' ? String(sender.user_id) : `c${sender.chat_id}`;
}

function userIdOf(sender: TdSender): number {
  return sender['@type'] === 'messageSenderUser' ? sender.user_id : sender.chat_id;
}

function chatSenderId(id: ParticipantId): number | null {
  return /^c-?\d+$/.test(id) ? Number(id.slice(1)) : null;
}

function supergroupChatId(supergroupId: number): number {
  return -1_000_000_000_000 - supergroupId;
}

function inMainList(chat: TdChat): boolean {
  return chat.positions.some((p) => p.list['@type'] === 'chatListMain' && p.order !== '0');
}

function withPosition(positions: TdChatPosition[], position: TdChatPosition): TdChatPosition[] {
  const rest = positions.filter((p) => p.list['@type'] !== position.list['@type']);
  return position.order === '0' ? rest : [...rest, position];
}

function mapRole(status: TdMemberStatus | undefined): GroupRole {
  if (status === 'chatMemberStatusCreator') return 'owner';
  if (status === 'chatMemberStatusAdministrator') return 'admin';
  return 'member';
}

export function handleOf(user: TdUser): string {
  const username = user.usernames?.active_usernames[0];
  if (username) return `@${username}`;
  if (user.phone_number) return `+${user.phone_number}`;
  return String(user.id);
}

export function nameOf(user: TdUser): string {
  if (user.type['@type'] === 'userTypeDeleted') return 'Deleted account';
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || handleOf(user);
}

function inputContent(content: MessageContent): TdObject {
  switch (content.kind) {
    case 'text':
      return { '@type': 'inputMessageText', text: formatted(content.text) };
    case 'image':
      return {
        '@type': 'inputMessagePhoto',
        photo: localFile(content.uri),
        width: content.width ?? 0,
        height: content.height ?? 0,
        ...(content.caption ? { caption: formatted(content.caption) } : {}),
      };
    case 'file':
      return { '@type': 'inputMessageDocument', document: localFile(content.uri) };
    case 'voice':
      return {
        '@type': 'inputMessageVoiceNote',
        voice_note: localFile(content.uri),
        duration: Math.round(content.durationMs / 1000),
      };
    default:
      throw new Error(`Telegram cannot send "${content.kind}" content`);
  }
}

function formatted(text: string): TdObject {
  return markdownToFormatted(text);
}

function localFile(uri: string): TdObject {
  return { '@type': 'inputFileLocal', path: pathOfFileUri(uri) };
}

function describeCodeDelivery(type: string | undefined): string {
  switch (type) {
    case 'authenticationCodeTypeTelegramMessage':
      return 'Telegram sent the code to your other signed-in devices.';
    case 'authenticationCodeTypeSms':
    case 'authenticationCodeTypeSmsWord':
    case 'authenticationCodeTypeSmsPhrase':
      return 'Telegram sent the code by SMS.';
    case 'authenticationCodeTypeCall':
      return 'Telegram is calling you with the code.';
    case 'authenticationCodeTypeFlashCall':
    case 'authenticationCodeTypeMissedCall':
      return 'Telegram is calling you; the code is the last digits of the calling number.';
    case 'authenticationCodeTypeFragment':
      return 'The code is on fragment.com for this number.';
    default:
      return 'Enter the code Telegram sent you.';
  }
}

function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PHONE_NUMBER_INVALID'))
    return 'That is not a valid phone number. Include the country code, like +44.';
  if (message.includes('PHONE_NUMBER_UNOCCUPIED'))
    return 'There is no Telegram account for that number.';
  if (message.includes('PHONE_NUMBER_BANNED')) return 'Telegram has banned that number.';
  if (message.includes('PHONE_CODE_INVALID')) return 'That code is not right.';
  if (message.includes('PHONE_CODE_EXPIRED'))
    return 'That code has expired. Save and reconnect to get a new one.';
  if (message.includes('PASSWORD_HASH_INVALID')) return 'Wrong password.';
  if (message.includes('API_ID_INVALID') || message.includes('API_ID_PUBLISHED_FLOOD')) {
    return 'Telegram rejected the API ID and hash. Check them at my.telegram.org.';
  }
  const flood = message.match(/retry after (\d+)/i);
  if (flood) return `Too many attempts. Wait ${flood[1]} seconds before trying again.`;
  return message;
}
