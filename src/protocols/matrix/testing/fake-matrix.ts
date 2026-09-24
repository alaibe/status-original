import type {
  MatrixApi,
  MxEvent,
  MxMedia,
  MxMember,
  MxOutgoing,
  MxProfile,
  MxPublicRoom,
  MxRoom,
  MxSession,
  MxStartParams,
  MxTextOutgoing,
  MxUpdate,
} from '../api';

/**
 * matrix-rust-sdk as a scripted peer: rooms, timelines and profiles are
 * plain maps the test fills in, calls are recorded, and tests push updates
 * with `emit`.
 */
export class FakeMatrix implements MatrixApi {
  readonly roomsById = new Map<string, MxRoom>();
  readonly timelines = new Map<string, MxEvent[]>();
  readonly roomMembers = new Map<string, MxMember[]>();
  readonly pinnedIds = new Map<string, string[]>();
  readonly profiles = new Map<string, MxProfile>();
  readonly calls: { name: string; args: unknown[] }[] = [];
  startParams: MxStartParams | null = null;
  loginResult: MxSession | Error = SESSION;
  closed = false;
  erased = false;
  private readonly listeners = new Set<(update: MxUpdate) => void>();

  /** Rooms the SDK would announce as soon as sync starts. */
  async start(params: MxStartParams): Promise<MxSession | null> {
    this.startParams = params;
    if (params.session) {
      queueMicrotask(() => {
        for (const room of this.roomsById.values()) this.emit({ type: 'room', room });
      });
    }
    return params.session;
  }

  async login(password: string): Promise<MxSession> {
    this.record('login', password);
    if (this.loginResult instanceof Error) throw this.loginResult;
    return this.loginResult;
  }

  async logout(): Promise<void> {
    this.record('logout');
  }

  async room(id: string): Promise<MxRoom | null> {
    return this.roomsById.get(id) ?? null;
  }

  async messages(roomId: string, opts: { limit: number; before?: string }): Promise<MxEvent[]> {
    this.record('messages', roomId, opts);
    const all = this.timelines.get(roomId) ?? [];
    const end = opts.before ? all.findIndex((event) => event.id === opts.before) : all.length;
    return all.slice(Math.max(0, end - opts.limit), end);
  }

  async members(roomId: string): Promise<MxMember[]> {
    this.record('members', roomId);
    return this.roomMembers.get(roomId) ?? [];
  }

  async profile(userId: string): Promise<MxProfile | null> {
    this.record('profile', userId);
    return this.profiles.get(userId) ?? null;
  }

  async previewPublicRoom(idOrAlias: string, via: string[]): Promise<MxPublicRoom> {
    this.record('previewPublicRoom', idOrAlias, via);
    const room = this.roomsById.get(idOrAlias);
    if (!room) throw new Error('Room not found');
    return {
      id: room.id,
      name: room.name,
      topic: room.topic,
      avatarUrl: room.avatarUrl,
      memberCount: room.memberCount ?? 0,
      joined: room.membership === 'joined',
      canJoin: true,
      canRequestJoin: false,
    };
  }

  async joinPublicRoom(idOrAlias: string, via: string[]): Promise<string> {
    this.record('joinPublicRoom', idOrAlias, via);
    const room = this.roomsById.get(idOrAlias);
    if (!room) throw new Error('Room not found');
    this.roomsById.set(room.id, { ...room, membership: 'joined' });
    return room.id;
  }

  async knockPublicRoom(idOrAlias: string, via: string[]): Promise<void> {
    this.record('knockPublicRoom', idOrAlias, via);
  }

  async createDm(userId: string): Promise<string> {
    this.record('createDm', userId);
    const id = `!dm-${userId}`;
    this.roomsById.set(id, room(id, { isDm: true, heroes: [userId], name: userId }));
    return id;
  }

  async createRoom(userIds: string[], name: string): Promise<string> {
    this.record('createRoom', userIds, name);
    const id = `!room-${name}`;
    this.roomsById.set(id, room(id, { name, heroes: userIds }));
    return id;
  }

  async invite(roomId: string, userId: string): Promise<void> {
    this.record('invite', roomId, userId);
  }

  async kick(roomId: string, userId: string): Promise<void> {
    this.record('kick', roomId, userId);
  }

  async ban(roomId: string, userId: string): Promise<void> {
    this.record('ban', roomId, userId);
  }

  async setPowerLevel(roomId: string, userId: string, level: number): Promise<void> {
    this.record('setPowerLevel', roomId, userId, level);
  }

  async setName(roomId: string, name: string): Promise<void> {
    this.record('setName', roomId, name);
  }

  async join(roomId: string): Promise<void> {
    this.record('join', roomId);
  }

  async leave(roomId: string): Promise<void> {
    this.record('leave', roomId);
  }

  async ignore(userId: string, ignored: boolean): Promise<void> {
    this.record('ignore', userId, ignored);
  }

  async send(
    roomId: string,
    content: MxOutgoing,
    replyTo?: string,
    threadRoot?: string
  ): Promise<void> {
    this.record('send', roomId, content, replyTo, ...(threadRoot ? [threadRoot] : []));
  }

  async toggleReaction(roomId: string, eventId: string, key: string): Promise<void> {
    this.record('toggleReaction', roomId, eventId, key);
  }

  async redact(roomId: string, eventId: string): Promise<void> {
    this.record('redact', roomId, eventId);
  }

  async pinnedMessages(roomId: string): Promise<MxEvent[]> {
    this.record('pinnedMessages', roomId);
    const ids = this.pinnedIds.get(roomId) ?? [];
    return (this.timelines.get(roomId) ?? []).filter((event) => ids.includes(event.id));
  }

  async setPinned(roomId: string, eventId: string, pinned: boolean): Promise<void> {
    this.record('setPinned', roomId, eventId, pinned);
    const ids = this.pinnedIds.get(roomId) ?? [];
    this.pinnedIds.set(
      roomId,
      pinned ? [...new Set([...ids, eventId])] : ids.filter((id) => id !== eventId)
    );
  }

  async edit(roomId: string, eventId: string, content: MxTextOutgoing): Promise<void> {
    this.record('edit', roomId, eventId, content);
  }

  async setMarkedUnread(roomId: string, unread: boolean): Promise<void> {
    this.record('setMarkedUnread', roomId, unread);
  }

  async markRead(roomId: string): Promise<void> {
    this.record('markRead', roomId);
  }

  async setTyping(roomId: string, typing: boolean): Promise<void> {
    this.record('setTyping', roomId, typing);
  }

  async createPoll(roomId: string, question: string, options: string[]): Promise<void> {
    this.record('createPoll', roomId, question, options);
  }

  async votePoll(roomId: string, eventId: string, answerIds: string[]): Promise<void> {
    this.record('votePoll', roomId, eventId, answerIds);
  }

  async media(media: MxMedia): Promise<string> {
    this.record('media', media);
    return `/matrix/media/${media.name}`;
  }

  onUpdate(listener: (update: MxUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async erase(): Promise<void> {
    this.erased = true;
  }

  emit(update: MxUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  named(name: string): unknown[][] {
    return this.calls.filter((call) => call.name === name).map((call) => call.args);
  }

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }
}

export const ME = '@me:example.org';
export const BOB = '@bob:example.org';
export const CAROL = '@carol:example.org';

export const SESSION: MxSession = {
  accessToken: 'token',
  userId: ME,
  deviceId: 'DEVICE',
  homeserverUrl: 'https://example.org',
};

export const PARAMETERS = {
  dataDirectory: '/tmp/matrix',
  storePassphrase: 'pass',
  homeserverUrl: 'https://example.org',
  userId: ME,
  deviceName: 'test',
};

export function room(id: string, overrides: Partial<MxRoom> = {}): MxRoom {
  return {
    id,
    name: '',
    isDm: false,
    membership: 'joined',
    heroes: [],
    selfRole: 'member',
    ...overrides,
  };
}

export function textEvent(
  id: string,
  roomId: string,
  sender: string,
  body: string,
  overrides: Partial<MxEvent> = {}
): MxEvent {
  return {
    id,
    roomId,
    sender,
    timestamp: 1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000,
    isOwn: sender === ME,
    status: 'sent',
    content: { kind: 'text', body },
    ...overrides,
  };
}

export function imageEvent(id: string, roomId: string, sender: string, name: string): MxEvent {
  return textEvent(id, roomId, sender, '', {
    content: {
      kind: 'image',
      source: `mxc://example.org/${name}`,
      name,
      mimeType: 'image/png',
      width: 10,
      height: 20,
    },
  });
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
