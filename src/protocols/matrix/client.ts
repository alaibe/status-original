import * as sdk from '@unomed/react-native-matrix-sdk';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';

import type {
  MatrixApi,
  MxEvent,
  MxMedia,
  MxMember,
  MxOutgoing,
  MxProfile,
  MxPublicRoom,
  MxRole,
  MxRoom,
  MxSession,
  MxStartParams,
  MxTextOutgoing,
  MxUpdate,
} from './api';
import { applyDiff, type VectorDiff } from './native/diff';
import { extensionOf, mapContent, mapMembership, mapRole, nameOf, sendState } from './native/map';
import { fromSdkSession, latestOf, timelineConfiguration, toSdkSession } from './native/session';

const ROOM_PAGE = 500;
const HISTORY_PAGE = 40;
const LIVE_TIMELINES = 16;

interface LiveTimeline {
  timeline: sdk.TimelineLike;
  handle: sdk.TaskHandleLike;
  typingHandle: sdk.TaskHandleLike;
  items: sdk.TimelineItemLike[];
}

/**
 * matrix-rust-sdk through its React Native bindings. Rooms come from the
 * sliding-sync room list; a room's messages come from an SDK timeline that
 * stays live for the most recently opened rooms, so edits and reactions in
 * them arrive as updates too.
 */
class RnMatrixClient implements MatrixApi {
  private client!: sdk.ClientLike;
  private params!: MxStartParams;
  private syncService: sdk.SyncServiceLike | null = null;
  private roomEntries: sdk.RoomListEntriesWithDynamicAdaptersResultLike | null = null;
  private delegateHandle: sdk.TaskHandleLike | null | undefined;
  private readonly listeners = new Set<(update: MxUpdate) => void>();
  private readonly latestSeen = new Map<string, number>();
  private readonly live = new Map<string, LiveTimeline>();
  private readonly mapped = new WeakMap<sdk.TimelineItemLike, MxEvent | null>();
  private entries: sdk.RoomLike[] = [];
  private readonly subscribed = new Set<string>();

  async start(params: MxStartParams): Promise<MxSession | null> {
    this.params = params;
    const dir = new Directory(`file://${params.dataDirectory}`);
    if (!params.session && dir.exists) dir.delete();
    const store = new sdk.SqliteStoreBuilder(
      `${params.dataDirectory}/store`,
      `${params.dataDirectory}/cache`
    ).passphrase(params.storePassphrase);
    this.client = await new sdk.ClientBuilder()
      .sqliteStore(store)
      .homeserverUrl(params.homeserverUrl)
      .slidingSyncVersionBuilder(sdk.SlidingSyncVersionBuilder.DiscoverNative)
      .autoEnableCrossSigning(true)
      .build();
    this.delegateHandle = this.client.setDelegate({
      didReceiveAuthError: () => this.emit({ type: 'signedOut' }),
      onBackgroundTaskErrorReport: () => {},
    });
    if (!params.session) return null;
    await this.client.restoreSession(toSdkSession(params.session));
    await this.startSync();
    return fromSdkSession(this.client.session());
  }

  async login(password: string): Promise<MxSession> {
    await this.client.login(this.params.userId, password, this.params.deviceName, undefined);
    await this.startSync();
    return fromSdkSession(this.client.session());
  }

  async logout(): Promise<void> {
    await this.stopSync();
    await this.client.logout();
  }

  // ---- sync ----

  private async startSync(): Promise<void> {
    if (this.client.slidingSyncVersion() === sdk.SlidingSyncVersion.None) {
      throw new Error(
        'This homeserver does not support sliding sync (MSC4186), which the app needs.'
      );
    }
    const syncService = await this.client.syncService().finish();
    this.syncService = syncService;
    const allRooms = await syncService.roomListService().allRooms();
    this.roomEntries = allRooms.entriesWithDynamicAdapters(ROOM_PAGE, {
      onUpdate: (updates) => this.onRoomEntries(updates),
    });
    this.roomEntries.controller().setFilter(
      new sdk.RoomListEntriesDynamicFilterKind.All({
        filters: [
          new sdk.RoomListEntriesDynamicFilterKind.NonLeft(),
          new sdk.RoomListEntriesDynamicFilterKind.NonSpace(),
        ],
      })
    );
    await syncService.start();
  }

  private async stopSync(): Promise<void> {
    for (const live of this.live.values()) {
      live.handle.cancel();
      live.typingHandle.cancel();
    }
    this.live.clear();
    this.roomEntries?.entriesStream().cancel();
    this.roomEntries = null;
    this.entries = [];
    this.subscribed.clear();
    await this.syncService?.stop().catch(() => {});
    this.syncService = null;
  }

  /** Any change the SDK considers notable shows up here as a `Set`, so nothing else needs watching. */
  private onRoomEntries(updates: sdk.RoomListEntriesUpdate[]): void {
    const touched = new Map<string, sdk.RoomLike>();
    let grew = false;
    for (const update of updates) {
      const { changed, removed } = applyDiff(this.entries, update as VectorDiff<sdk.RoomLike>);
      grew ||=
        update.tag === sdk.RoomListEntriesUpdate_Tags.Append ||
        update.tag === sdk.RoomListEntriesUpdate_Tags.Reset;
      const kept = new Set(changed.map((room) => room.id()));
      // A `Set` brings a fresh handle for the same room; only rooms that left the list are gone.
      for (const room of removed) {
        if (kept.has(room.id())) continue;
        touched.delete(room.id());
        this.emit({ type: 'roomGone', roomId: room.id() });
      }
      for (const room of changed) touched.set(room.id(), room);
    }
    // The SDK only computes a room's latest event once it is subscribed to, as a list in view would be.
    const fresh = [...touched.keys()].filter((id) => !this.subscribed.has(id));
    if (fresh.length > 0) {
      for (const id of fresh) this.subscribed.add(id);
      this.syncService
        ?.roomListService()
        .subscribeToRooms(fresh)
        .catch(() => {});
    }
    for (const room of touched.values()) this.announce(room).catch(() => {});
    // Fetch the next page while the list keeps growing.
    if (grew && this.entries.length > 0 && this.entries.length % ROOM_PAGE === 0)
      this.roomEntries?.controller().addOnePage();
  }

  private async announce(room: sdk.RoomLike): Promise<void> {
    const mapped = await this.toMxRoom(room);
    if (!mapped) return;
    this.emit({ type: 'room', room: mapped });

    const stamp = mapped.latest?.timestamp;
    if (stamp === undefined || mapped.membership !== 'joined') return;
    const seen = this.latestSeen.get(mapped.id);
    if (seen !== undefined && seen >= stamp) return;
    this.latestSeen.set(mapped.id, stamp);
    // A live timeline already reported it; otherwise read the newest item once.
    if (seen === undefined || this.live.has(mapped.id)) return;
    const event = await this.newestEvent(room).catch(() => null);
    if (event) this.emit({ type: 'event', event });
  }

  /** The bindings' latest-event value has no id, so the newest timeline item stands in. */
  private async newestEvent(room: sdk.RoomLike): Promise<MxEvent | null> {
    const timeline = await room.timelineWithConfiguration(timelineConfiguration());
    try {
      const id = await timeline.latestEventId();
      if (!id) return null;
      return this.toMxEventItem(room.id(), await timeline.getEventTimelineItemByEventId(id));
    } finally {
      if (timeline instanceof sdk.Timeline) timeline.uniffiDestroy();
    }
  }

  // ---- rooms ----

  async room(id: string): Promise<MxRoom | null> {
    const room = this.client.getRoom(id);
    return room ? this.toMxRoom(room) : null;
  }

  private requireRoom(id: string): sdk.RoomLike {
    const room = this.client.getRoom(id);
    if (!room) throw new Error(`Unknown room ${id}`);
    return room;
  }

  private async toMxRoom(room: sdk.RoomLike): Promise<MxRoom | null> {
    const info = await room.roomInfo();
    if (info.isSpace) return null;
    const membership = mapMembership(info.membership);
    const joined = membership === 'joined';
    const [selfRole, latest] = await Promise.all([
      joined
        ? room
            .suggestedRoleForUser(room.ownUserId())
            .then(mapRole)
            .catch((): MxRole => 'member')
        : ('member' as MxRole),
      joined ? latestOf(room).catch(() => undefined) : undefined,
    ]);
    const heroes = info.heroes.map((hero) => hero.userId);
    const messageType = new sdk.MessageLikeEventType.RoomMessage();
    const power = info.powerLevels;
    const requiredToSend = power
      ? ([...power.events()].find(
          ([type]) =>
            type.tag === sdk.TimelineEventType_Tags.MessageLike &&
            type.inner.value.tag === sdk.MessageLikeEventType_Tags.RoomMessage
        )?.[1] ?? power.values().eventsDefault)
      : 0n;
    return {
      id: info.id,
      name: info.displayName ?? info.rawName ?? '',
      topic: info.topic,
      avatarUrl: info.avatarUrl,
      canonicalAlias: info.canonicalAlias,
      memberCount: Number(info.activeMembersCount),
      isDm: info.isDm,
      broadcast: !info.isDm && !!power && requiredToSend > power.values().usersDefault,
      canSend: joined && (power ? power.canOwnUserSendMessage(messageType) : true),
      peer: info.isDm
        ? heroes.find((id) => id !== room.ownUserId() && !info.serviceMembers.includes(id))
        : undefined,
      membership,
      heroes,
      selfRole,
      inviter: info.inviter?.userId,
      latest,
      unreadCount: Number(info.numUnreadMessages),
      mentionCount: Number(info.numUnreadMentions),
      markedUnread: info.isMarkedUnread,
      canPin: joined && (power?.canOwnUserPinUnpin() ?? true),
      canDeleteOthers: joined && !!power?.canOwnUserRedactOther(),
      sendLevel: power ? Number(requiredToSend) : undefined,
      defaultLevel: power ? Number(power.values().usersDefault) : undefined,
    };
  }

  // ---- timelines ----

  private async liveTimeline(roomId: string): Promise<LiveTimeline> {
    const existing = this.live.get(roomId);
    if (existing) {
      // Most recently used goes last.
      this.live.delete(roomId);
      this.live.set(roomId, existing);
      return existing;
    }
    const room = this.requireRoom(roomId);
    const timeline = await room.timelineWithConfiguration(timelineConfiguration());
    const items: sdk.TimelineItemLike[] = [];
    const handle = await timeline.addListener({
      onUpdate: (diffs) => {
        for (const diff of diffs) {
          const { changed } = applyDiff(items, diff as VectorDiff<sdk.TimelineItemLike>, true);
          for (const item of changed) this.emitItem(roomId, item);
        }
      },
    });
    const typingHandle = room.subscribeToTypingNotifications({
      call: (userIds) => this.emit({ type: 'typing', roomId, userIds }),
    });
    const live = { timeline, handle, typingHandle, items };
    this.live.set(roomId, live);
    while (this.live.size > LIVE_TIMELINES) {
      const [oldest, entry] = this.live.entries().next().value as [string, LiveTimeline];
      this.live.delete(oldest);
      entry.handle.cancel();
      entry.typingHandle.cancel();
    }
    return live;
  }

  private emitItem(roomId: string, item: sdk.TimelineItemLike): void {
    const event = this.toMxEvent(roomId, item);
    if (!event) return;
    this.latestSeen.set(roomId, event.timestamp);
    this.emit({ type: 'event', event });
  }

  async messages(roomId: string, opts: { limit: number; before?: string }): Promise<MxEvent[]> {
    const live = await this.liveTimeline(roomId);
    for (;;) {
      const events = live.items
        .map((item) => this.toMxEvent(roomId, item))
        .filter((e): e is MxEvent => e !== null);
      const end = opts.before
        ? events.findIndex((event) => event.id === opts.before)
        : events.length;
      if (end >= opts.limit) return events.slice(end - opts.limit, end);
      const hitStart = await live.timeline.paginateBackwards(
        Math.max(HISTORY_PAGE, opts.limit - Math.max(end, 0))
      );
      if (hitStart) {
        const all = live.items
          .map((item) => this.toMxEvent(roomId, item))
          .filter((e): e is MxEvent => e !== null);
        const stop = opts.before ? all.findIndex((event) => event.id === opts.before) : all.length;
        return stop < 0 ? [] : all.slice(Math.max(0, stop - opts.limit), stop);
      }
    }
  }

  /** Memoised per item: a `Set` diff brings a new item object, so identity is the cache key. */
  private toMxEvent(roomId: string, item: sdk.TimelineItemLike): MxEvent | null {
    const cached = this.mapped.get(item);
    if (cached !== undefined) return cached;
    const event = item.asEvent();
    const mapped = event ? this.toMxEventItem(roomId, event) : null;
    this.mapped.set(item, mapped);
    return mapped;
  }

  /** Local echoes are skipped: our own sends surface once the homeserver has them. */
  private toMxEventItem(roomId: string, event: sdk.EventTimelineItem): MxEvent | null {
    if (event.eventOrTransactionId.tag !== sdk.EventOrTransactionId_Tags.EventId) return null;
    const content = mapContent(event.content);
    if (!content) return null;
    const msgLike =
      event.content.tag === sdk.TimelineItemContent_Tags.MsgLike
        ? event.content.inner.content
        : null;
    const reactions = msgLike?.reactions.map((reaction) => ({
      key: reaction.key,
      senders: reaction.senders.map((sender) => sender.senderId),
    }));
    return {
      id: event.eventOrTransactionId.inner.eventId,
      roomId,
      sender: event.sender,
      senderName: nameOf(event.senderProfile),
      timestamp: Number(event.timestamp),
      isOwn: event.isOwn,
      status: sendState(event.localSendState),
      content,
      replyTo: msgLike?.threadRoot && fallsBack(event) ? undefined : msgLike?.inReplyTo?.eventId(),
      threadRoot: msgLike?.threadRoot,
      reactions: reactions && reactions.length > 0 ? reactions : undefined,
      edited:
        msgLike?.kind.tag === sdk.MsgLikeKind_Tags.Message && msgLike.kind.inner.content.isEdited,
    };
  }

  // ---- people ----

  async members(roomId: string): Promise<MxMember[]> {
    const iterator = await this.requireRoom(roomId).members();
    const out: MxMember[] = [];
    for (;;) {
      const chunk = iterator.nextChunk(ROOM_PAGE);
      if (!chunk || chunk.length === 0) break;
      for (const member of chunk) {
        if (member.membership.tag !== sdk.MembershipState_Tags.Join) continue;
        out.push({
          userId: member.userId,
          displayName: member.displayName,
          role: mapRole(member.suggestedRoleForPowerLevel),
          powerLevel:
            member.powerLevel.tag === sdk.PowerLevel_Tags.Value
              ? Number(member.powerLevel.inner.value)
              : undefined,
        });
      }
    }
    return out;
  }

  async profile(userId: string): Promise<MxProfile | null> {
    const profile = await this.client.getProfile(userId).catch(() => null);
    return profile ? { userId: profile.userId, displayName: profile.displayName } : null;
  }

  async previewPublicRoom(idOrAlias: string, via: string[]): Promise<MxPublicRoom> {
    const preview = idOrAlias.startsWith('#')
      ? await this.client.getRoomPreviewFromRoomAlias(idOrAlias)
      : await this.client.getRoomPreviewFromRoomId(idOrAlias, via);
    const info = preview.info();
    return {
      id: info.roomId,
      name: info.name ?? info.canonicalAlias ?? idOrAlias,
      topic: info.topic,
      avatarUrl: info.avatarUrl,
      memberCount: Number(info.numJoinedMembers),
      joined: info.membership === sdk.Membership.Joined,
      canJoin: info.joinRule?.tag === sdk.JoinRule_Tags.Public,
      canRequestJoin:
        info.joinRule?.tag === sdk.JoinRule_Tags.Knock ||
        info.joinRule?.tag === sdk.JoinRule_Tags.KnockRestricted,
    };
  }

  async joinPublicRoom(idOrAlias: string, via: string[]): Promise<string> {
    const room = await this.client.joinRoomByIdOrAlias(idOrAlias, via);
    return room.id();
  }

  async knockPublicRoom(idOrAlias: string, via: string[]): Promise<void> {
    await this.client.knock(idOrAlias, undefined, via);
  }

  async createDm(userId: string): Promise<string> {
    return this.client.createRoom({
      isEncrypted: true,
      isDirect: true,
      visibility: new sdk.RoomVisibility.Private(),
      preset: sdk.RoomPreset.TrustedPrivateChat,
      invite: [userId],
      isSpace: false,
    });
  }

  async createRoom(userIds: string[], name: string): Promise<string> {
    return this.client.createRoom({
      name,
      isEncrypted: true,
      isDirect: false,
      visibility: new sdk.RoomVisibility.Private(),
      preset: sdk.RoomPreset.PrivateChat,
      invite: userIds,
      isSpace: false,
    });
  }

  async invite(roomId: string, userId: string): Promise<void> {
    await this.requireRoom(roomId).inviteUserById(userId);
  }

  async kick(roomId: string, userId: string): Promise<void> {
    await this.requireRoom(roomId).kickUser(userId, undefined);
  }

  async ban(roomId: string, userId: string): Promise<void> {
    await this.requireRoom(roomId).banUser(userId, undefined);
  }

  async setPowerLevel(roomId: string, userId: string, level: number): Promise<void> {
    await this.requireRoom(roomId).updatePowerLevelsForUsers([
      { userId, powerLevel: BigInt(level) },
    ]);
  }

  async setName(roomId: string, name: string): Promise<void> {
    await this.requireRoom(roomId).setName(name);
  }

  async join(roomId: string): Promise<void> {
    await this.requireRoom(roomId).join();
  }

  async leave(roomId: string): Promise<void> {
    await this.requireRoom(roomId).leave();
  }

  async ignore(userId: string, ignored: boolean): Promise<void> {
    if (ignored) await this.client.ignoreUser(userId);
    else await this.client.unignoreUser(userId);
  }

  // ---- sending ----

  /**
   * Text goes straight to the homeserver, so a rejection rejects here.
   * Attachments go through the SDK's send queue, which resolves once queued.
   */
  /** Whom a reply notifies, as the desktop driver's `AddMentions::Yes` does. */
  private async senderOf(room: sdk.RoomLike, eventId: string): Promise<string | undefined> {
    try {
      const sender = (await room.loadOrFetchEvent(eventId)).senderId();
      return sender === this.client.userId() ? undefined : sender;
    } catch {
      return undefined;
    }
  }

  async send(
    roomId: string,
    content: MxOutgoing,
    replyTo?: string,
    threadRoot?: string
  ): Promise<void> {
    const room = this.requireRoom(roomId);
    if (content.kind === 'text') {
      const relates = relation(replyTo, threadRoot);
      const repliedTo = replyTo ? await this.senderOf(room, replyTo) : undefined;
      const mentions = [
        ...new Set([...(content.mentions ?? []), ...(repliedTo ? [repliedTo] : [])]),
      ];
      await room.sendRaw(
        'm.room.message',
        JSON.stringify({
          msgtype: 'm.text',
          body: content.body,
          ...(content.html
            ? { format: 'org.matrix.custom.html', formatted_body: content.html }
            : {}),
          ...(mentions.length ? { 'm.mentions': { user_ids: mentions } } : {}),
          ...(relates ? { 'm.relates_to': relates } : {}),
        })
      );
      return;
    }
    if (!threadRoot) {
      await sendMedia((await this.liveTimeline(roomId)).timeline, content, replyTo);
      return;
    }
    // A thread-focused timeline threads what it sends.
    const thread = await room.timelineWithConfiguration({
      ...timelineConfiguration(),
      focus: new sdk.TimelineFocus.Thread({ rootEventId: threadRoot }),
    });
    try {
      await sendMedia(thread, content, replyTo);
    } finally {
      if (thread instanceof sdk.Timeline) thread.uniffiDestroy();
    }
  }

  async toggleReaction(roomId: string, eventId: string, key: string): Promise<void> {
    const live = await this.liveTimeline(roomId);
    await live.timeline.toggleReaction(new sdk.EventOrTransactionId.EventId({ eventId }), key);
  }

  async redact(roomId: string, eventId: string): Promise<void> {
    await this.requireRoom(roomId).redact(eventId, undefined);
  }

  async pinnedMessages(roomId: string): Promise<MxEvent[]> {
    const room = this.requireRoom(roomId);
    const timeline = await room.timelineWithConfiguration({
      ...timelineConfiguration(),
      focus: new sdk.TimelineFocus.PinnedEvents(),
    });
    try {
      const ids = (await room.roomInfo()).pinnedEventIds;
      const items = await Promise.all(
        ids.map((id) => timeline.getEventTimelineItemByEventId(id).catch(() => null))
      );
      return items
        .map((item) => item && this.toMxEventItem(roomId, item))
        .filter((event): event is MxEvent => event !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
    } finally {
      if (timeline instanceof sdk.Timeline) timeline.uniffiDestroy();
    }
  }

  async setPinned(roomId: string, eventId: string, pinned: boolean): Promise<void> {
    const timeline = (await this.liveTimeline(roomId)).timeline;
    if (pinned) await timeline.pinEvent(eventId);
    else await timeline.unpinEvent(eventId);
  }

  async edit(roomId: string, eventId: string, content: MxTextOutgoing): Promise<void> {
    let replacement = content.html
      ? sdk.messageEventContentFromHtml(content.body, content.html)
      : sdk.messageEventContentNew(
          new sdk.MessageType.Text({
            content: sdk.TextMessageContent.create({ body: content.body }),
          })
        );
    if (content.mentions?.length)
      replacement = replacement.withMentions({ userIds: content.mentions, room: false });
    await this.requireRoom(roomId).edit(eventId, replacement);
  }

  async markRead(roomId: string): Promise<void> {
    await this.requireRoom(roomId).markAsRead(sdk.ReceiptType.Read);
  }

  async setMarkedUnread(roomId: string, unread: boolean): Promise<void> {
    await this.requireRoom(roomId).setUnreadFlag(unread);
  }

  async setTyping(roomId: string, typing: boolean): Promise<void> {
    await this.requireRoom(roomId).typingNotice(typing);
  }

  async createPoll(roomId: string, question: string, options: string[]): Promise<void> {
    await (await this.liveTimeline(roomId)).timeline.createPoll(
      question,
      options,
      1,
      sdk.PollKind.Disclosed
    );
  }

  async votePoll(roomId: string, eventId: string, answerIds: string[]): Promise<void> {
    await (await this.liveTimeline(roomId)).timeline.sendPollResponse(eventId, answerIds);
  }

  // ---- media ----

  async media(media: MxMedia): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      media.source
    );
    const file = new File(
      `file://${this.params.dataDirectory}/media/${digest.slice(0, 32)}${extensionOf(media.name)}`
    );
    if (!file.exists) {
      const bytes = await this.client.getMediaContent(sdk.MediaSource.fromJson(media.source));
      file.create({ intermediates: true });
      file.write(new Uint8Array(bytes));
    }
    return file.uri.replace(/^file:\/\//, '');
  }

  // ---- lifecycle ----

  onUpdate(listener: (update: MxUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(update: MxUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  async close(): Promise<void> {
    await this.stopSync();
    this.delegateHandle?.cancel();
    this.listeners.clear();
  }

  async erase(): Promise<void> {
    await this.close();
    const dir = new Directory(`file://${this.params.dataDirectory}`);
    if (dir.exists) dir.delete();
  }
}

/** In a thread, a message that replies to nothing still points at the root, for clients without threads. */
function relation(replyTo?: string, threadRoot?: string) {
  if (!threadRoot) return replyTo ? { 'm.in_reply_to': { event_id: replyTo } } : undefined;
  return {
    rel_type: 'm.thread',
    event_id: threadRoot,
    is_falling_back: !replyTo,
    'm.in_reply_to': { event_id: replyTo ?? threadRoot },
  };
}

/** A thread message quotes the one before it for clients without threads; that is not a reply. */
function fallsBack(event: sdk.EventTimelineItem): boolean {
  const json = event.lazyProvider.debugInfo().originalJson;
  if (!json) return false;
  try {
    return JSON.parse(json).content?.['m.relates_to']?.is_falling_back === true;
  } catch {
    return false;
  }
}

async function sendMedia(
  timeline: sdk.TimelineLike,
  content: Exclude<MxOutgoing, { kind: 'text' }>,
  replyTo: string | undefined
): Promise<void> {
  const source = new sdk.UploadSource.File({ filename: content.path });
  const size = content.size === undefined ? undefined : BigInt(content.size);
  switch (content.kind) {
    case 'image':
      await timeline
        .sendImage({ source, caption: content.caption, inReplyTo: replyTo }, undefined, {
          width: content.width === undefined ? undefined : BigInt(content.width),
          height: content.height === undefined ? undefined : BigInt(content.height),
          mimetype: content.mimeType,
          size,
        })
        .join();
      return;
    case 'file':
      await timeline
        .sendFile({ source, inReplyTo: replyTo }, { mimetype: content.mimeType, size })
        .join();
      return;
    case 'video':
      await timeline
        .sendVideo({ source, caption: content.caption, inReplyTo: replyTo }, undefined, {
          width: content.width === undefined ? undefined : BigInt(content.width),
          height: content.height === undefined ? undefined : BigInt(content.height),
          mimetype: content.mimeType,
          size,
        })
        .join();
      return;
    case 'voice':
      await timeline
        .sendVoiceMessage(
          { source, inReplyTo: replyTo },
          { duration: content.durationMs, mimetype: content.mimeType, size },
          []
        )
        .join();
      return;
  }
}

/** uniffi errors carry the homeserver's message inside `inner`; surface it as the message. */
function unwrapped(target: RnMatrixClient): MatrixApi {
  const api = {} as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(RnMatrixClient.prototype)) {
    const method = (target as unknown as Record<string, unknown>)[key];
    if (key === 'constructor' || typeof method !== 'function') continue;
    api[key] = (...args: unknown[]) => {
      try {
        const result = (method as (...a: unknown[]) => unknown).apply(target, args);
        return result instanceof Promise
          ? result.catch((error) => Promise.reject(toError(error)))
          : result;
      } catch (error) {
        throw toError(error);
      }
    };
  }
  return api as unknown as MatrixApi;
}

function toError(error: unknown): Error {
  const inner = (error as { inner?: { msg?: unknown; code?: unknown } } | null)?.inner;
  if (!inner) return error instanceof Error ? error : new Error(String(error));
  const msg =
    typeof inner.msg === 'string'
      ? inner.msg
      : error instanceof Error
        ? error.message
        : String(error);
  return new Error(typeof inner.code === 'string' ? `${inner.code}: ${msg}` : msg);
}

export const MatrixClient = {
  create: async (): Promise<MatrixApi> => unwrapped(new RnMatrixClient()),
};
