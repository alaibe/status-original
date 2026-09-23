import type { ChatSession, LoginState } from '@/core/messaging/protocol';
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
import { htmlToMarkdown } from '@/core/messaging/html-markdown';
import { markdownHtml, plainText } from '@/core/messaging/markdown';
import { localFileUri, pathOfFileUri } from '@/storage/media';

import type {
  MatrixApi,
  MxEvent,
  MxMedia,
  MxMember,
  MxOutgoing,
  MxPreview,
  MxRoom,
  MxSession,
  MxStartParams,
  MxUpdate,
} from './api';
import { bridgedNetwork } from './bridges';
import { conversationIdOf, localpart, parseUserId, roomIdOf, USER_ID } from './ids';
import { BridgeProvisioning, type MatrixCapabilities } from './provisioning';

/** Bots write links as Markdown autolinks; the brackets are not part of the URL. */
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/g;

export const MATRIX_PROTOCOL_ID = 'matrix';

export interface MatrixConnectOptions {
  createApi(): Promise<MatrixApi>;
  parameters: MxStartParams;
  /** Called with the session after sign-in and with null after sign-out. */
  persistSession(session: MxSession | null): Promise<void>;
}

/**
 * A Matrix client over matrix-rust-sdk, which owns history, keys and media
 * in its own store. Joined rooms and invitations are surfaced; spaces are
 * not conversations.
 */
export class MatrixSession implements ChatSession, MatrixCapabilities {
  private api!: MatrixApi;
  private unsubscribe: Unsubscribe | null = null;
  private userId: string | null = null;
  private login: LoginState | null = null;
  private readonly loginListeners = new Set<(login: LoginState | null) => void>();
  private readonly messageListeners = new Set<(message: ChatMessage) => void>();
  private readonly conversationListeners = new Set<(conversation: Conversation) => void>();
  private readonly rooms = new Map<string, MxRoom>();
  private readonly members = new Map<string, MxMember[]>();
  private readonly pendingMembers = new Map<string, Promise<MxMember[]>>();
  private readonly names = new Map<string, string>();
  /** Once a room shows its bridge it keeps it, even after the bridged users fall out of the summary. */
  private readonly networks = new Map<string, string>();
  private readonly mediaPaths = new Map<string, string>();
  private readonly awaitedMedia = new Map<string, MxEvent>();

  private constructor(private readonly options: MatrixConnectOptions) {}

  static async connect(options: MatrixConnectOptions): Promise<MatrixSession> {
    const session = new MatrixSession(options);
    await session.start();
    return session;
  }

  get self(): SelfIdentity {
    return this.userId
      ? { participantId: this.userId, address: this.userId }
      : { participantId: '', address: '' };
  }

  private async start(): Promise<void> {
    this.api = await this.options.createApi();
    this.unsubscribe = this.api.onUpdate((update) => {
      this.handleUpdate(update).catch(() => {});
    });
    const session = await this.api.start(this.options.parameters);
    if (session) await this.onReady(session);
    else this.askForPassword();
  }

  /** A session that ended, however it ended, leaves nothing worth keeping. */
  private async restart(error?: string): Promise<void> {
    this.userId = null;
    this.options.parameters.session = null;
    await this.options.persistSession(null);
    this.rooms.clear();
    this.members.clear();
    this.pendingMembers.clear();
    this.awaitedMedia.clear();
    this.unsubscribe?.();
    await this.api.close();
    await this.start();
    if (error && this.login) this.setLogin({ ...this.login, error });
  }

  // ---- sign-in ----

  subscribeLogin(listener: (login: LoginState | null) => void): Unsubscribe {
    this.loginListeners.add(listener);
    listener(this.login);
    return () => this.loginListeners.delete(listener);
  }

  async submitLogin(value: string): Promise<void> {
    const current = this.login;
    if (!current) throw new Error('Matrix is not asking for anything right now.');
    this.setLogin({ ...current, error: undefined });
    try {
      const session = await this.api.login(value);
      await this.onReady(session);
    } catch (error) {
      const message = describeLoginError(error);
      this.setLogin({ ...current, error: message });
      throw new Error(message);
    }
  }

  bridgeProvisioning(bridge: string): BridgeProvisioning | null {
    const { session, homeserverUrl } = this.options.parameters;
    if (!session || !this.userId) return null;
    const base = `${homeserverUrl}/_matrix/provision/${encodeURIComponent(bridge)}`;
    const query = `user_id=${encodeURIComponent(this.userId)}`;
    return new BridgeProvisioning(async (path, init = {}) => {
      const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}${query}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await response.text();
      let json: { error?: string } = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {}
      if (!response.ok) throw new Error(json.error ?? `The bridge answered ${response.status}.`);
      return json;
    });
  }

  async signOut(): Promise<void> {
    await this.api.logout();
    await this.restart();
  }

  private askForPassword(): void {
    const { userId, homeserverUrl } = this.options.parameters;
    this.setLogin({
      step: 'password',
      hint: `The password for ${userId} on ${new URL(homeserverUrl).host}.`,
    });
  }

  private setLogin(login: LoginState | null): void {
    this.login = login;
    for (const listener of this.loginListeners) listener(login);
  }

  private async onReady(session: MxSession): Promise<void> {
    this.userId = session.userId;
    this.options.parameters.session = session;
    await this.options.persistSession(session);
    this.setLogin(null);
  }

  // ---- updates ----

  private async handleUpdate(update: MxUpdate): Promise<void> {
    switch (update.type) {
      case 'room':
        return this.onRoom(update.room);
      case 'roomGone':
        this.rooms.delete(update.roomId);
        this.forgetMembers(update.roomId);
        return;
      case 'event':
        return this.emitMessage(update.event);
      case 'signedOut':
        return this.restart('The homeserver ended this session. Sign in again.');
    }
  }

  private onRoom(room: MxRoom): void {
    this.rooms.set(room.id, room);
    if (room.isDm) this.forgetMembers(room.id);
    if (room.isDm && room.heroes.length === 1 && room.name)
      this.names.set(room.heroes[0], room.name);
    if (included(room)) this.announce(room);
  }

  private announce(room: MxRoom): void {
    if (this.conversationListeners.size === 0) return;
    const conversation = this.toConversation(room);
    for (const listener of this.conversationListeners) listener(conversation);
  }

  private async emitMessage(raw: MxEvent): Promise<void> {
    if (this.messageListeners.size === 0) return;
    const room = this.rooms.get(raw.roomId);
    if (room && !included(room)) return;
    const message = this.toMessage(raw, true);
    for (const listener of this.messageListeners) listener(message);
  }

  // ---- ChatSession ----

  async listConversations(): Promise<Conversation[]> {
    if (!this.userId) return [];
    return [...this.rooms.values()].filter(included).map((room) => this.toConversation(room));
  }

  async getMessages(
    id: ConversationId,
    opts?: { limit?: number; before?: { sentAt: number; id: MessageId } }
  ): Promise<ChatMessage[]> {
    if (!this.userId) return [];
    const roomId = roomIdOf(id);
    const events = await this.api.messages(roomId, {
      limit: opts?.limit ?? 50,
      before: opts?.before?.id,
    });
    const room = this.rooms.get(roomId);
    if (room && !room.isDm) void this.membersOf(roomId);
    return events.map((event) => this.toMessage(event, true));
  }

  async resolvePeer(addressOrId: string): Promise<ParticipantId | null> {
    const userId = parseUserId(addressOrId);
    if (!userId || userId === this.userId) return null;
    const profile = await this.api.profile(userId).catch(() => null);
    if (!profile) return null;
    if (profile.displayName) this.names.set(userId, profile.displayName);
    return userId;
  }

  async resolveAddresses(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    return Object.fromEntries(ids.filter((id) => USER_ID.test(id)).map((id) => [id, id]));
  }

  async resolveNames(ids: ParticipantId[]): Promise<Record<ParticipantId, string>> {
    const unknown = [...new Set(ids)].filter((id) => !this.names.has(id) && USER_ID.test(id));
    await Promise.all(
      unknown.map(async (id) => {
        const profile = await this.api.profile(id).catch(() => null);
        if (profile?.displayName) this.names.set(id, profile.displayName);
      })
    );
    const out: Record<ParticipantId, string> = {};
    for (const id of ids) {
      const name = this.names.get(id);
      if (name) out[id] = name;
    }
    return out;
  }

  async createDm(peer: ParticipantId): Promise<Conversation> {
    const existing = [...this.rooms.values()].find(
      (room) => room.isDm && room.membership === 'joined' && this.peerOf(room) === peer
    );
    return this.toConversation(existing ?? (await this.requireRoom(await this.api.createDm(peer))));
  }

  async createGroup(peers: ParticipantId[], title: string): Promise<Conversation> {
    return this.toConversation(await this.requireRoom(await this.api.createRoom(peers, title)));
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    const members = await this.membersOf(roomIdOf(id));
    return members.map((member) => ({ id: member.userId, role: member.role }));
  }

  async addMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    const roomId = roomIdOf(id);
    await Promise.all(peers.map((peer) => this.api.invite(roomId, peer)));
    this.forgetMembers(roomId);
  }

  async removeMembers(id: ConversationId, peers: ParticipantId[]): Promise<void> {
    const roomId = roomIdOf(id);
    await Promise.all(peers.map((peer) => this.api.kick(roomId, peer)));
    this.forgetMembers(roomId);
  }

  async renameGroup(id: ConversationId, title: string): Promise<void> {
    await this.api.setName(roomIdOf(id), title);
  }

  async leaveGroup(id: ConversationId): Promise<void> {
    await this.api.leave(roomIdOf(id));
  }

  /** The real id arrives with the echo; until then the store keeps its own pending entry. */
  async send(id: ConversationId, content: MessageContent, replyTo?: MessageId): Promise<MessageId> {
    const roomId = roomIdOf(id);
    if (content.kind === 'reaction') {
      await this.api.toggleReaction(roomId, content.targetId, content.emoji);
      return `${content.targetId}_reaction`;
    }
    await this.api.send(roomId, outgoing(content), replyTo);
    return `local:${Date.now()}`;
  }

  /** An invitation is a request; a denied DM ignores the sender and leaves. */
  async setConsent(id: ConversationId, consent: 'allowed' | 'denied'): Promise<void> {
    const roomId = roomIdOf(id);
    const room = this.rooms.get(roomId) ?? (await this.api.room(roomId));
    if (!room) return;
    if (room.membership === 'invited') {
      if (consent === 'allowed') await this.api.join(roomId);
      else await this.api.leave(roomId);
      return;
    }
    if (consent === 'denied' && room.isDm) {
      const peer = this.peerOf(room);
      if (peer) await this.api.ignore(peer, true);
      await this.api.leave(roomId);
    }
  }

  async sendReadReceipt(id: ConversationId): Promise<void> {
    await this.api.markRead(roomIdOf(id));
  }

  /** The SDK syncs continuously; there is nothing to pull. */
  async sync(): Promise<void> {}

  async streamMessages(onMessage: (m: ChatMessage) => void): Promise<Unsubscribe> {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  async streamConversations(onConversation: (c: Conversation) => void): Promise<Unsubscribe> {
    this.conversationListeners.add(onConversation);
    for (const room of this.rooms.values()) {
      if (included(room)) onConversation(this.toConversation(room));
    }
    return () => this.conversationListeners.delete(onConversation);
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.close();
  }

  async eraseLocalDatabase(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.api.erase();
  }

  // ---- mapping ----

  private async requireRoom(roomId: string): Promise<MxRoom> {
    const room = this.rooms.get(roomId) ?? (await this.api.room(roomId));
    if (!room) throw new Error('The room did not appear.');
    this.rooms.set(room.id, room);
    return room;
  }

  /** Fetched once per room; a DM's peer is known without it. */
  private membersOf(roomId: string): Promise<MxMember[]> {
    const known = this.members.get(roomId);
    if (known) return Promise.resolve(known);
    let pending = this.pendingMembers.get(roomId);
    if (!pending) {
      pending = this.api
        .members(roomId)
        .then((members) => {
          for (const member of members) {
            if (member.displayName) this.names.set(member.userId, member.displayName);
          }
          this.members.set(roomId, members);
          const room = this.rooms.get(roomId);
          if (room && members.length > 0) this.announce(room);
          return members;
        })
        .finally(() => this.pendingMembers.delete(roomId));
      this.pendingMembers.set(roomId, pending);
    }
    return pending;
  }

  private forgetMembers(roomId: string): void {
    this.members.delete(roomId);
    this.pendingMembers.delete(roomId);
  }

  private peerOf(room: MxRoom): string | null {
    const selfId = this.self.participantId;
    return (
      room.peer ??
      room.heroes.find((id) => id !== selfId) ??
      (room.inviter !== selfId ? room.inviter : null) ??
      null
    );
  }

  private toConversation(room: MxRoom): Conversation {
    const selfId = this.self.participantId;
    const peer = this.peerOf(room);
    const known = this.members.get(room.id);
    const memberIds = room.isDm
      ? [...new Set([peer ?? room.id, selfId])]
      : [...new Set([...(known?.map((member) => member.userId) ?? room.heroes), selfId])];

    const network =
      this.networks.get(room.id) ??
      bridgedNetwork([peer, room.latest?.sender, room.inviter, ...room.heroes]);
    if (network) this.networks.set(room.id, network);

    return {
      id: conversationIdOf(room.id),
      kind: room.isDm ? 'dm' : 'group',
      network,
      title: room.name || (room.isDm ? (peer ?? room.id) : 'Untitled room'),
      memberIds,
      createdAt: room.latest?.timestamp ?? 0,
      lastMessage: room.latest ? this.toMessage(previewEvent(room), false) : undefined,
      consent: room.membership === 'invited' ? 'unknown' : 'allowed',
      selfRole: room.isDm ? undefined : room.selfRole,
    };
  }

  private toMessage(raw: MxEvent, fetchMedia: boolean): ChatMessage {
    if (raw.senderName) this.names.set(raw.sender, raw.senderName);
    const reactions = raw.reactions?.filter((r) => r.senders.length > 0) ?? [];
    return {
      id: raw.id,
      conversationId: conversationIdOf(raw.roomId),
      senderId: raw.sender,
      sentAt: raw.timestamp,
      content: this.toContent(raw, fetchMedia),
      fromMe: raw.isOwn,
      status: raw.status,
      replyTo: raw.replyTo,
      reactions:
        reactions.length > 0
          ? Object.fromEntries(reactions.map((r) => [r.key, r.senders]))
          : undefined,
    };
  }

  private toContent(raw: MxEvent, fetchMedia: boolean): MessageContent {
    const content = raw.content;
    switch (content.kind) {
      case 'text': {
        const body = content.html
          ? htmlToMarkdown(content.html)
          : content.body.replace(AUTOLINK, '$1');
        return { kind: 'text', text: content.msgtype === 'emote' ? `\\* ${body}` : body };
      }

      case 'image': {
        const uri = this.mediaUri(raw, content, fetchMedia);
        if (!uri)
          return {
            kind: 'unsupported',
            typeId: 'image',
            fallback: withCaption('📷 Photo', content.caption),
          };
        return {
          kind: 'image',
          uri,
          name: content.name,
          width: content.width,
          height: content.height,
          size: content.size,
          mimeType: content.mimeType,
          caption: content.caption,
        };
      }

      case 'file': {
        const uri = this.mediaUri(raw, content, fetchMedia);
        if (!uri)
          return {
            kind: 'unsupported',
            typeId: 'file',
            fallback: withCaption(`📎 ${content.name}`, content.caption),
          };
        return {
          kind: 'file',
          uri,
          name: content.name,
          mimeType: content.mimeType,
          size: content.size,
        };
      }

      case 'audio': {
        if (!content.voice)
          return { kind: 'unsupported', typeId: 'audio', fallback: `🎵 ${content.name}` };
        const uri = this.mediaUri(raw, content, fetchMedia);
        if (!uri) return { kind: 'unsupported', typeId: 'voice', fallback: '🎤 Voice message' };
        return {
          kind: 'voice',
          uri,
          durationMs: content.durationMs ?? 0,
          size: content.size,
          mimeType: content.mimeType,
        };
      }

      case 'video':
        return { kind: 'unsupported', typeId: 'video', fallback: '🎬 Video' };
      case 'sticker':
        return { kind: 'unsupported', typeId: 'sticker', fallback: content.body || 'Sticker' };
      case 'poll':
        return { kind: 'unsupported', typeId: 'poll', fallback: `📊 ${content.question}` };
      case 'location':
        return { kind: 'unsupported', typeId: 'location', fallback: '📍 Location' };
      case 'redacted':
        return { kind: 'unsupported', typeId: 'redacted', fallback: 'Message deleted' };
      case 'undecryptable':
        return {
          kind: 'unsupported',
          typeId: 'undecryptable',
          fallback: '🔒 Waiting for the keys to this message',
        };

      case 'membership': {
        if (content.userName) this.names.set(content.user, content.userName);
        const who = this.nameOf(content.user);
        const by = this.nameOf(raw.sender);
        switch (content.change) {
          case 'joined':
            return { kind: 'system', text: `${who} joined` };
          case 'left':
            return { kind: 'system', text: `${who} left` };
          case 'invited':
            return { kind: 'system', text: `${by} invited ${who}` };
          case 'kicked':
            return { kind: 'system', text: `${by} removed ${who}` };
          case 'banned':
            return { kind: 'system', text: `${by} banned ${who}` };
          case 'unbanned':
            return { kind: 'system', text: `${by} unbanned ${who}` };
          case 'invitationRejected':
            return { kind: 'system', text: `${who} declined the invitation` };
          case 'invitationRevoked':
            return { kind: 'system', text: `${by} withdrew the invitation for ${who}` };
        }
      }

      case 'state':
        switch (content.change) {
          case 'name':
            return {
              kind: 'system',
              text: content.value ? `Renamed to "${content.value}"` : 'Name removed',
            };
          case 'topic':
            return {
              kind: 'system',
              text: content.value ? `Topic set to "${content.value}"` : 'Topic removed',
            };
          case 'avatar':
            return { kind: 'system', text: 'Room photo changed' };
          case 'created':
            return { kind: 'system', text: 'Room created' };
          case 'encryption':
            return { kind: 'system', text: 'Encryption enabled' };
        }
    }
  }

  /**
   * Media is downloaded on request. A file that is not local yet renders as
   * a placeholder, and the message is re-emitted once it is.
   */
  private mediaUri(raw: MxEvent, media: MxMedia, fetchMedia: boolean): string | null {
    const path = this.mediaPaths.get(media.source);
    if (path) return localFileUri(path);
    if (!fetchMedia) return null;
    if (!this.awaitedMedia.has(media.source)) {
      this.awaitedMedia.set(media.source, raw);
      this.api
        .media(media)
        .then((downloaded) => {
          this.mediaPaths.set(media.source, downloaded);
          const event = this.awaitedMedia.get(media.source);
          this.awaitedMedia.delete(media.source);
          if (event) return this.emitMessage(event);
        })
        .catch(() => this.awaitedMedia.delete(media.source));
    }
    return null;
  }

  private nameOf(userId: string): string {
    return this.names.get(userId) ?? localpart(userId);
  }
}

// ---- helpers ----

function included(room: MxRoom): boolean {
  return room.membership === 'joined' || room.membership === 'invited';
}

/** The list needs a `ChatMessage`; the preview has no id, so it gets one nothing else will match. */
function previewEvent(room: MxRoom): MxEvent {
  const latest = room.latest as MxPreview;
  return {
    ...latest,
    id: `preview:${room.id}:${latest.timestamp}`,
    roomId: room.id,
    status: 'sent',
  };
}

function withCaption(label: string, caption: string | undefined): string {
  return caption ? `${label} · ${caption}` : label;
}

function outgoing(content: MessageContent): MxOutgoing {
  switch (content.kind) {
    case 'text': {
      const html = markdownHtml(content.text);
      return html
        ? { kind: 'text', body: plainText(content.text), html }
        : { kind: 'text', body: content.text };
    }
    case 'image':
      return {
        kind: 'image',
        path: pathOfFileUri(content.uri),
        mimeType: content.mimeType,
        width: content.width,
        height: content.height,
        size: content.size,
        caption: content.caption,
      };
    case 'file':
      return {
        kind: 'file',
        path: pathOfFileUri(content.uri),
        name: content.name,
        mimeType: content.mimeType,
        size: content.size,
      };
    case 'voice':
      return {
        kind: 'voice',
        path: pathOfFileUri(content.uri),
        durationMs: content.durationMs,
        mimeType: content.mimeType,
        size: content.size,
      };
    default:
      throw new Error(`Matrix cannot send "${content.kind}" content`);
  }
}

function describeLoginError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/M_FORBIDDEN|Invalid username\/password|invalid password/i.test(message))
    return 'Wrong password.';
  if (/M_USER_DEACTIVATED/.test(message)) return 'That account has been deactivated.';
  if (/M_LIMIT_EXCEEDED/.test(message))
    return 'Too many attempts. Wait a moment before trying again.';
  if (/M_UNKNOWN_TOKEN/.test(message)) return 'The homeserver rejected the session. Sign in again.';
  if (/dns error|connection refused|failed to lookup|ENOTFOUND/i.test(message)) {
    return 'The homeserver could not be reached. Check the URL.';
  }
  return message;
}
