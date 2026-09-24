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
import { localFileUri } from '@/storage/media';

import type {
  MatrixApi,
  MxEvent,
  MxMedia,
  MxMember,
  MxPreview,
  MxRoom,
  MxSession,
  MxStartParams,
  MxUpdate,
} from './api';
import { bridgedNetwork } from './bridges';
import { toContent } from './content';
import { outgoing, textOutgoing } from './outgoing';
import {
  conversationIdOf,
  localpart,
  parseRoomReference,
  parseUserId,
  permalink,
  roomIdOf,
  USER_ID,
} from './ids';
import { Homeserver } from './homeserver';
import { PresenceWatcher } from './presence';
import { searchHomeserver } from './search';
import { inviteLink, knocks } from './join-requests';
import { BridgeProvisioning, type MatrixCapabilities } from './provisioning';

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
  readonly sendsVideo = true;
  private api!: MatrixApi;
  private unsubscribe: Unsubscribe | null = null;
  private userId: string | null = null;
  private login: LoginState | null = null;
  private readonly loginListeners = new Set<(login: LoginState | null) => void>();
  private readonly messageListeners = new Set<(message: ChatMessage) => void>();
  private readonly conversationListeners = new Set<(conversation: Conversation) => void>();
  private readonly rooms = new Map<string, MxRoom>();
  private readonly typing = new Map<string, boolean>();
  private readonly pollAnswers = new Map<string, string[]>();
  private readonly members = new Map<string, MxMember[]>();
  private readonly pendingMembers = new Map<string, Promise<MxMember[]>>();
  private readonly names = new Map<string, string>();
  /** Once a room shows its bridge it keeps it, even after the bridged users fall out of the summary. */
  private readonly networks = new Map<string, string>();
  private readonly mediaPaths = new Map<string, string>();
  private readonly awaitedMedia = new Map<string, MxEvent>();
  private readonly avatars = new Map<string, string | null>();
  private readonly presence = new PresenceWatcher(
    () => this.homeserver(),
    (userId) => this.announceDmsWith(userId)
  );

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
    this.typing.clear();
    this.pollAnswers.clear();
    this.members.clear();
    this.pendingMembers.clear();
    this.awaitedMedia.clear();
    this.avatars.clear();
    this.presence.clear();
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
    const homeserver = this.homeserver()?.at(`/_matrix/provision/${encodeURIComponent(bridge)}`);
    if (!homeserver || !this.userId) return null;
    const query = `user_id=${encodeURIComponent(this.userId)}`;
    return new BridgeProvisioning((path, init = {}) =>
      homeserver.request(
        init.method ?? 'GET',
        `${path}${path.includes('?') ? '&' : '?'}${query}`,
        init.body
      )
    );
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
        this.typing.delete(update.roomId);
        this.forgetMembers(update.roomId);
        return;
      case 'typing': {
        const active = update.userIds.some((id) => id !== this.userId);
        this.typing.set(update.roomId, active);
        const room = this.rooms.get(update.roomId);
        if (room && included(room)) this.announce(room);
        return;
      }
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

  private announceDmsWith(userId: string): void {
    for (const room of this.rooms.values())
      if (room.isDm && included(room) && this.peerOf(room) === userId) this.announce(room);
  }

  private homeserver(): Homeserver | null {
    const { session, homeserverUrl } = this.options.parameters;
    return session ? new Homeserver(homeserverUrl, session.accessToken) : null;
  }

  private requireHomeserver(): Homeserver {
    const homeserver = this.homeserver();
    if (!homeserver) throw new Error('Sign in to Matrix first.');
    return homeserver;
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

  async previewPublicChat(input: string): Promise<PublicChatPreview> {
    const reference = parseRoomReference(input);
    if (!reference) throw new Error('Enter a Matrix room alias, ID, or matrix.to link.');
    const room = await this.api.previewPublicRoom(reference.idOrAlias, reference.via);
    const joinedRoom = room.joined ? await this.api.room(room.id) : null;
    return {
      id: input.trim(),
      title: room.name,
      kind: joinedRoom ? (joinedRoom.broadcast ? 'channel' : 'group') : 'room',
      joined: room.joined,
      requiresApproval: room.canRequestJoin && !room.joined,
      description: room.topic,
      avatarUri: await this.roomAvatar(room.avatarUrl),
      memberCount: room.memberCount,
      link: permalink(reference.idOrAlias),
      joinUnavailableReason:
        !room.canJoin && !room.canRequestJoin && !room.joined
          ? 'This room requires an invitation.'
          : undefined,
    };
  }

  async joinPublicChat(id: ConversationId): Promise<Conversation | null> {
    const reference = parseRoomReference(id);
    if (!reference) throw new Error('That Matrix room link is invalid.');
    const room = await this.api.previewPublicRoom(reference.idOrAlias, reference.via);
    if (!room.joined && room.canRequestJoin) {
      await this.api.knockPublicRoom(reference.idOrAlias, reference.via);
      return null;
    }
    if (!room.joined && !room.canJoin) throw new Error('This room requires an invitation.');
    const roomId = room.joined
      ? room.id
      : await this.api.joinPublicRoom(reference.idOrAlias, reference.via);
    return this.toConversation(await this.requireRoom(roomId));
  }

  async getMembers(id: ConversationId): Promise<GroupMember[]> {
    const roomId = roomIdOf(id);
    const sendLevel = this.rooms.get(roomId)?.sendLevel;
    const members = await this.membersOf(roomId);
    return members.map((member) => ({
      id: member.userId,
      role: member.role,
      ...(member.powerLevel !== undefined &&
      sendLevel !== undefined &&
      member.powerLevel < sendLevel
        ? { muted: true }
        : {}),
    }));
  }

  async banMember(id: ConversationId, peer: ParticipantId): Promise<void> {
    await this.api.ban(roomIdOf(id), peer);
    this.forgetMembers(roomIdOf(id));
  }

  async setMemberMuted(id: ConversationId, peer: ParticipantId, muted: boolean): Promise<void> {
    const room = await this.requireRoom(roomIdOf(id));
    await this.api.setPowerLevel(
      room.id,
      peer,
      muted ? (room.sendLevel ?? 0) - 1 : (room.defaultLevel ?? 0)
    );
    this.forgetMembers(room.id);
  }

  async getGroupInfo(id: ConversationId): Promise<GroupInfo> {
    const room = await this.requireRoom(roomIdOf(id));
    return {
      description: room.topic,
      avatarUri: await this.roomAvatar(room.avatarUrl),
      memberCount: room.memberCount,
      link: permalink(room.canonicalAlias ?? room.id),
    };
  }

  private avatarOf(room: MxRoom): string | undefined {
    const url = room.avatarUrl;
    if (!url) return undefined;
    const known = this.avatars.get(url);
    if (known !== undefined) return known ?? undefined;
    this.avatars.set(url, null);
    void this.roomAvatar(url).then((uri) => {
      if (!uri) return;
      this.avatars.set(url, uri);
      const current = this.rooms.get(room.id);
      if (current?.avatarUrl === url && included(current)) this.announce(current);
    });
    return undefined;
  }

  private async roomAvatar(url?: string): Promise<string | undefined> {
    if (!url) return undefined;
    return this.api
      .media({ source: JSON.stringify({ url }), name: 'avatar' })
      .then(localFileUri)
      .catch(() => undefined);
  }

  async mentionCandidates(id: ConversationId, query: string): Promise<MentionCandidate[]> {
    const needle = query.toLowerCase();
    const members = await this.membersOf(roomIdOf(id));
    return members
      .filter((member) => member.userId !== this.userId)
      .map((member) => ({
        id: member.userId,
        name: member.displayName || localpart(member.userId),
        handle: member.userId,
      }))
      .filter(
        (member) =>
          member.name.toLowerCase().includes(needle) || member.handle.toLowerCase().includes(needle)
      )
      .slice(0, 20);
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

  async deleteMessage(id: ConversationId, messageId: MessageId): Promise<void> {
    await this.api.redact(roomIdOf(id), messageId);
  }

  async listPinnedMessages(id: ConversationId): Promise<ChatMessage[]> {
    const events = await this.api.pinnedMessages(roomIdOf(id));
    return events.map((event) => ({ ...this.toMessage(event, true), isPinned: true }));
  }

  async setMessagePinned(id: ConversationId, messageId: MessageId, pinned: boolean): Promise<void> {
    await this.api.setPinned(roomIdOf(id), messageId, pinned);
  }

  async editMessage(id: ConversationId, messageId: MessageId, text: string): Promise<void> {
    await this.api.edit(roomIdOf(id), messageId, textOutgoing(text));
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

  async getJoinRequests(id: ConversationId): Promise<JoinRequest[]> {
    return knocks(this.requireHomeserver(), roomIdOf(id));
  }

  async processJoinRequest(
    id: ConversationId,
    userId: ParticipantId,
    approve: boolean
  ): Promise<void> {
    if (approve) await this.api.invite(roomIdOf(id), userId);
    else await this.api.kick(roomIdOf(id), userId);
  }

  async createInviteLink(id: ConversationId, requiresApproval: boolean): Promise<string> {
    const room = await this.requireRoom(roomIdOf(id));
    return inviteLink(this.requireHomeserver(), room, this.self.participantId, requiresApproval);
  }

  async searchMessages(query: string, id?: ConversationId): Promise<ChatMessage[]> {
    const homeserver = this.homeserver();
    if (!homeserver || !this.userId) return [];
    const events = await searchHomeserver(homeserver, query, this.userId, id && roomIdOf(id));
    return events
      .filter((event) => {
        const room = this.rooms.get(event.roomId);
        return room !== undefined && included(room);
      })
      .map((event) => this.toMessage(event, false));
  }

  async setMarkedUnread(id: ConversationId, unread: boolean): Promise<void> {
    await this.api.setMarkedUnread(roomIdOf(id), unread);
  }

  watchPresence(id: ConversationId): Unsubscribe {
    const room = this.rooms.get(roomIdOf(id));
    const peer = room?.isDm ? this.peerOf(room) : null;
    return peer ? this.presence.watch(peer) : () => {};
  }

  async setTyping(id: ConversationId, typing: boolean): Promise<void> {
    await this.api.setTyping(roomIdOf(id), typing);
  }

  async createPoll(id: ConversationId, question: string, options: string[]): Promise<void> {
    await this.api.createPoll(roomIdOf(id), question, options);
  }

  async votePoll(id: ConversationId, messageId: MessageId, optionIds: number[]): Promise<void> {
    const answers = this.pollAnswers.get(messageId);
    if (!answers) throw new Error('Load this poll before voting.');
    const selected = optionIds.map((index) => answers[index]);
    if (selected.some((answer) => !answer)) throw new Error('That poll choice is unavailable.');
    await this.api.votePoll(roomIdOf(id), messageId, selected);
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
    const presence = room.isDm && peer ? this.presence.get(peer) : undefined;
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
      kind: room.isDm ? 'dm' : room.broadcast ? 'channel' : 'group',
      canSend: room.canSend,
      typing: this.typing.get(room.id) ?? false,
      ...(presence?.online ? { online: true } : {}),
      ...(presence?.lastSeenAt ? { lastSeenAt: presence.lastSeenAt } : {}),
      network,
      title: room.name || (room.isDm ? (peer ?? room.id) : 'Untitled room'),
      avatarUri: this.avatarOf(room),
      memberIds,
      createdAt: room.latest?.timestamp ?? 0,
      lastMessage: room.latest ? this.toMessage(previewEvent(room), false) : undefined,
      unreadCount: room.unreadCount,
      mentionCount: room.mentionCount,
      ...(room.markedUnread ? { markedUnread: true } : {}),
      canPin: room.canPin,
      canDeleteOthers: room.canDeleteOthers,
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
      content: toContent(raw, {
        selfId: this.userId ?? undefined,
        media: (media) => this.mediaUri(raw, media, fetchMedia),
        nameOf: (userId) => this.nameOf(userId),
        learnName: (userId, name) => this.names.set(userId, name),
        learnPoll: (eventId, answerIds) => this.pollAnswers.set(eventId, answerIds),
      }),
      fromMe: raw.isOwn,
      status: raw.status,
      replyTo: raw.replyTo,
      ...(raw.edited ? { edited: true } : {}),
      reactions:
        reactions.length > 0
          ? Object.fromEntries(reactions.map((r) => [r.key, r.senders]))
          : undefined,
    };
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
