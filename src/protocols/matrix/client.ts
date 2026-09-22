import * as sdk from '@unomed/react-native-matrix-sdk';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';

import type {
  MatrixApi,
  MxContent,
  MxEvent,
  MxMedia,
  MxMember,
  MxMembership,
  MxMembershipChange,
  MxOutgoing,
  MxPreview,
  MxProfile,
  MxRole,
  MxRoom,
  MxSession,
  MxStartParams,
  MxUpdate,
} from './api';

const ROOM_PAGE = 500;
const HISTORY_PAGE = 40;
const LIVE_TIMELINES = 16;

interface LiveTimeline {
  timeline: sdk.TimelineLike;
  handle: sdk.TaskHandleLike;
  items: sdk.TimelineItemLike[];
}

/** A vector diff from the SDK, as both the room list and timelines deliver them. */
type VectorDiff<T> =
  | { tag: 'Append' | 'Reset'; inner: { values: T[] } }
  | { tag: 'PushFront' | 'PushBack'; inner: { value: T } }
  | { tag: 'Insert' | 'Set'; inner: { index: number; value: T } }
  | { tag: 'Remove'; inner: { index: number } }
  | { tag: 'Truncate'; inner: { length: number } }
  | { tag: 'Clear' | 'PopFront' | 'PopBack' };

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
    for (const live of this.live.values()) live.handle.cancel();
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
    return {
      id: info.id,
      name: info.displayName ?? info.rawName ?? '',
      isDm: info.isDm,
      peer: info.isDm ? heroes.find((id) => id !== room.ownUserId()) : undefined,
      membership,
      heroes,
      selfRole,
      inviter: info.inviter?.userId,
      latest,
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
    const timeline = await this.requireRoom(roomId).timelineWithConfiguration(
      timelineConfiguration()
    );
    const items: sdk.TimelineItemLike[] = [];
    const handle = await timeline.addListener({
      onUpdate: (diffs) => {
        for (const diff of diffs) {
          const { changed } = applyDiff(items, diff as VectorDiff<sdk.TimelineItemLike>, true);
          for (const item of changed) this.emitItem(roomId, item);
        }
      },
    });
    const live = { timeline, handle, items };
    this.live.set(roomId, live);
    while (this.live.size > LIVE_TIMELINES) {
      const [oldest, entry] = this.live.entries().next().value as [string, LiveTimeline];
      this.live.delete(oldest);
      entry.handle.cancel();
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
      replyTo: msgLike?.inReplyTo?.eventId(),
      reactions: reactions && reactions.length > 0 ? reactions : undefined,
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
        });
      }
    }
    return out;
  }

  async profile(userId: string): Promise<MxProfile | null> {
    const profile = await this.client.getProfile(userId).catch(() => null);
    return profile ? { userId: profile.userId, displayName: profile.displayName } : null;
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
  async send(roomId: string, content: MxOutgoing, replyTo?: string): Promise<void> {
    const room = this.requireRoom(roomId);
    if (content.kind === 'text') {
      const relates = replyTo ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyTo } } } : {};
      await room.sendRaw(
        'm.room.message',
        JSON.stringify({ msgtype: 'm.text', body: content.body, ...relates })
      );
      return;
    }
    const { timeline } = await this.liveTimeline(roomId);
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

  async toggleReaction(roomId: string, eventId: string, key: string): Promise<void> {
    const live = await this.liveTimeline(roomId);
    await live.timeline.toggleReaction(new sdk.EventOrTransactionId.EventId({ eventId }), key);
  }

  async markRead(roomId: string): Promise<void> {
    await this.requireRoom(roomId).markAsRead(sdk.ReceiptType.Read);
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

// ---- mapping ----

/**
 * Applies one diff in place. `changed` holds items worth reporting; with
 * `newOnly`, bulk loads (initial items, pagination) are applied silently.
 */
function applyDiff<T>(
  items: T[],
  diff: VectorDiff<T>,
  newOnly = false
): { changed: T[]; removed: T[] } {
  switch (diff.tag) {
    case 'Append':
      items.push(...diff.inner.values);
      return { changed: newOnly ? [] : diff.inner.values, removed: [] };
    case 'Reset': {
      const removed = items.splice(0, items.length, ...diff.inner.values);
      return { changed: newOnly ? [] : diff.inner.values, removed: newOnly ? [] : removed };
    }
    case 'Clear':
      return { changed: [], removed: items.splice(0, items.length) };
    case 'PushFront':
      items.unshift(diff.inner.value);
      return { changed: newOnly ? [] : [diff.inner.value], removed: [] };
    case 'PushBack':
      items.push(diff.inner.value);
      return { changed: [diff.inner.value], removed: [] };
    case 'PopFront':
      return { changed: [], removed: items.splice(0, 1) };
    case 'PopBack':
      return { changed: [], removed: items.splice(-1, 1) };
    case 'Insert': {
      items.splice(diff.inner.index, 0, diff.inner.value);
      const atEnd = diff.inner.index === items.length - 1;
      return { changed: !newOnly || atEnd ? [diff.inner.value] : [], removed: [] };
    }
    case 'Set': {
      const removed = items.splice(diff.inner.index, 1, diff.inner.value);
      return { changed: [diff.inner.value], removed: newOnly ? [] : removed };
    }
    case 'Remove':
      return { changed: [], removed: items.splice(diff.inner.index, 1) };
    case 'Truncate':
      return { changed: [], removed: items.splice(diff.inner.length) };
  }
}

function timelineConfiguration(): sdk.TimelineConfiguration {
  return {
    focus: new sdk.TimelineFocus.Live({ hideThreadedEvents: false }),
    filter: new sdk.TimelineFilter.All(),
    dateDividerMode: sdk.DateDividerMode.Daily,
    // The app shows no receipts, and tracking them re-emits every message whenever one moves.
    trackReadReceipts: sdk.TimelineReadReceiptTracking.Disabled,
    reportUtds: false,
  };
}

async function latestOf(room: sdk.RoomLike): Promise<MxPreview | undefined> {
  const value = await room.latestEvent();
  if (
    value.tag !== sdk.LatestEventValue_Tags.Remote &&
    value.tag !== sdk.LatestEventValue_Tags.Local
  )
    return undefined;
  const content = mapContent(value.inner.content);
  if (!content) return undefined;
  return {
    sender: value.inner.sender,
    senderName: nameOf(value.inner.profile),
    timestamp: Number(value.inner.timestamp),
    isOwn: value.tag === sdk.LatestEventValue_Tags.Local || value.inner.isOwn,
    content,
  };
}

function toSdkSession(session: MxSession): sdk.Session {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.userId,
    deviceId: session.deviceId,
    homeserverUrl: session.homeserverUrl,
    oauthData: undefined,
    slidingSyncVersion: sdk.SlidingSyncVersion.Native,
  };
}

function fromSdkSession(session: sdk.Session): MxSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.userId,
    deviceId: session.deviceId,
    homeserverUrl: session.homeserverUrl,
  };
}

function mapMembership(membership: sdk.Membership): MxMembership {
  switch (membership) {
    case sdk.Membership.Invited:
      return 'invited';
    case sdk.Membership.Joined:
      return 'joined';
    case sdk.Membership.Banned:
      return 'banned';
    case sdk.Membership.Knocked:
      return 'knocked';
    default:
      return 'left';
  }
}

function mapRole(role: sdk.RoomMemberRole): MxRole {
  switch (role) {
    case sdk.RoomMemberRole.Creator:
      return 'owner';
    case sdk.RoomMemberRole.Administrator:
    case sdk.RoomMemberRole.Moderator:
      return 'admin';
    default:
      return 'member';
  }
}

function nameOf(profile: sdk.ProfileDetails): string | undefined {
  return profile.tag === sdk.ProfileDetails_Tags.Ready
    ? (profile.inner.displayName ?? undefined)
    : undefined;
}

function sendState(state: sdk.EventSendState | undefined): MxEvent['status'] {
  if (!state) return 'sent';
  switch (state.tag) {
    case sdk.EventSendState_Tags.Sent:
      return 'sent';
    case sdk.EventSendState_Tags.SendingFailed:
      return 'failed';
    default:
      return 'sending';
  }
}

/** Null for events the app never shows, so they never count as messages. */
function mapContent(content: sdk.TimelineItemContent): MxContent | null {
  switch (content.tag) {
    case sdk.TimelineItemContent_Tags.MsgLike:
      return mapMsgLike(content.inner.content.kind);
    case sdk.TimelineItemContent_Tags.RoomMembership: {
      const change = mapMembershipChange(content.inner.change);
      return change
        ? {
            kind: 'membership',
            change,
            user: content.inner.userId,
            userName: content.inner.userDisplayName,
          }
        : null;
    }
    case sdk.TimelineItemContent_Tags.State:
      return mapState(content.inner.content);
    default:
      return null;
  }
}

function mapMsgLike(kind: sdk.MsgLikeKind): MxContent | null {
  switch (kind.tag) {
    case sdk.MsgLikeKind_Tags.Message:
      return mapMessage(kind.inner.content.msgType);
    case sdk.MsgLikeKind_Tags.Sticker:
      return { kind: 'sticker', body: kind.inner.body };
    case sdk.MsgLikeKind_Tags.Poll:
      return { kind: 'poll', question: kind.inner.question };
    case sdk.MsgLikeKind_Tags.Redacted:
      return { kind: 'redacted' };
    case sdk.MsgLikeKind_Tags.UnableToDecrypt:
      return { kind: 'undecryptable' };
    case sdk.MsgLikeKind_Tags.LiveLocation:
      return { kind: 'location' };
    default:
      return null;
  }
}

function mapMessage(type: sdk.MessageType): MxContent | null {
  switch (type.tag) {
    case sdk.MessageType_Tags.Text:
      return { kind: 'text', body: type.inner.content.body };
    case sdk.MessageType_Tags.Notice:
      return { kind: 'text', body: type.inner.content.body, msgtype: 'notice' };
    case sdk.MessageType_Tags.Emote:
      return { kind: 'text', body: type.inner.content.body, msgtype: 'emote' };
    case sdk.MessageType_Tags.Image: {
      const c = type.inner.content;
      return {
        kind: 'image',
        ...media(c.source, c.filename, c.info?.mimetype, c.info?.size),
        width: c.info?.width === undefined ? undefined : Number(c.info.width),
        height: c.info?.height === undefined ? undefined : Number(c.info.height),
        caption: c.caption,
      };
    }
    case sdk.MessageType_Tags.File: {
      const c = type.inner.content;
      return {
        kind: 'file',
        ...media(c.source, c.filename, c.info?.mimetype, c.info?.size),
        caption: c.caption,
      };
    }
    case sdk.MessageType_Tags.Audio: {
      const c = type.inner.content;
      const durationMs = c.info?.duration ?? c.audio?.duration;
      return {
        kind: 'audio',
        ...media(c.source, c.filename, c.info?.mimetype, c.info?.size),
        durationMs: durationMs === undefined ? undefined : Math.round(durationMs),
        voice: c.voice !== undefined,
      };
    }
    case sdk.MessageType_Tags.Video:
      return { kind: 'video' };
    case sdk.MessageType_Tags.Location:
      return { kind: 'location' };
    default:
      return null;
  }
}

function media(
  source: sdk.MediaSourceLike,
  name: string,
  mimeType: string | undefined,
  size: bigint | undefined
): MxMedia {
  return {
    source: source.toJson(),
    name,
    mimeType,
    size: size === undefined ? undefined : Number(size),
  };
}

function mapMembershipChange(change: sdk.MembershipChange | undefined): MxMembershipChange | null {
  switch (change) {
    case sdk.MembershipChange.Joined:
    case sdk.MembershipChange.InvitationAccepted:
      return 'joined';
    case sdk.MembershipChange.Left:
      return 'left';
    case sdk.MembershipChange.Invited:
      return 'invited';
    case sdk.MembershipChange.Kicked:
    case sdk.MembershipChange.KickedAndBanned:
      return 'kicked';
    case sdk.MembershipChange.Banned:
      return 'banned';
    case sdk.MembershipChange.Unbanned:
      return 'unbanned';
    case sdk.MembershipChange.InvitationRejected:
      return 'invitationRejected';
    case sdk.MembershipChange.InvitationRevoked:
      return 'invitationRevoked';
    default:
      return null;
  }
}

function mapState(state: sdk.OtherState): MxContent | null {
  switch (state.tag) {
    case sdk.OtherState_Tags.RoomName:
      return { kind: 'state', change: 'name', value: state.inner.name ?? undefined };
    case sdk.OtherState_Tags.RoomTopic:
      return { kind: 'state', change: 'topic', value: state.inner.topic ?? undefined };
    case sdk.OtherState_Tags.RoomAvatar:
      return { kind: 'state', change: 'avatar' };
    case sdk.OtherState_Tags.RoomCreate:
      return { kind: 'state', change: 'created' };
    case sdk.OtherState_Tags.RoomEncryption:
      return { kind: 'state', change: 'encryption' };
    default:
      return null;
  }
}

function extensionOf(name: string): string {
  const match = name.match(/\.[A-Za-z0-9]{1,5}$/);
  return match ? match[0].toLowerCase() : '';
}
