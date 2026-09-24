/**
 * What the adapter needs from matrix-rust-sdk, in plain data. The phone
 * driver (`client.ts`) builds it on the SDK's uniffi bindings and the desktop
 * driver (`client.web.ts`) on Tauri commands over the same crate, so every
 * shape here has to survive JSON.
 */

export interface MxStartParams {
  dataDirectory: string;
  /** Encrypts the SDK's SQLite stores, including the E2EE keys. */
  storePassphrase: string;
  homeserverUrl: string;
  userId: string;
  deviceName: string;
  /** Without one the driver starts from an empty store: a store only makes sense with its session. */
  session: MxSession | null;
}

/** The SDK's session, kept in the vault between runs. */
export interface MxSession {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  deviceId: string;
  homeserverUrl: string;
}

export type MxMembership = 'joined' | 'invited' | 'left' | 'banned' | 'knocked';

export type MxRole = 'owner' | 'admin' | 'member';

export interface MxRoom {
  id: string;
  name: string;
  topic?: string;
  avatarUrl?: string;
  canonicalAlias?: string;
  memberCount?: number;
  isDm: boolean;
  broadcast?: boolean;
  canSend?: boolean;
  /** The other side of a DM, when the SDK knows it. */
  peer?: string;
  membership: MxMembership;
  /** Who the room is named after when it has no name. */
  heroes: string[];
  selfRole: MxRole;
  inviter?: string;
  /** For the list; new messages arrive as `event` updates. */
  latest?: MxPreview;
  unreadCount?: number;
  markedUnread?: boolean;
  canPin?: boolean;
  canDeleteOthers?: boolean;
  /** The power level sending a message needs, and what members have unless set. */
  sendLevel?: number;
  defaultLevel?: number;
  mentionCount?: number;
}

export interface MxMember {
  userId: string;
  displayName?: string;
  role: MxRole;
  /** Unset for a room creator, whose power has no number. */
  powerLevel?: number;
}

export interface MxProfile {
  userId: string;
  displayName?: string;
}

export interface MxPublicRoom {
  id: string;
  name: string;
  topic?: string;
  avatarUrl?: string;
  memberCount: number;
  joined: boolean;
  canJoin: boolean;
  canRequestJoin: boolean;
}

export interface MxReaction {
  key: string;
  senders: string[];
}

export interface MxPreview {
  sender: string;
  senderName?: string;
  timestamp: number;
  isOwn: boolean;
  content: MxContent;
}

export interface MxEvent extends MxPreview {
  id: string;
  roomId: string;
  status: 'sending' | 'sent' | 'failed';
  replyTo?: string;
  threadRoot?: string;
  reactions?: MxReaction[];
  edited?: boolean;
}

export interface MxMedia {
  /** The SDK's serialised MediaSource: an mxc URL or an encrypted file. */
  source: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export type MxMembershipChange =
  | 'joined'
  | 'left'
  | 'invited'
  | 'kicked'
  | 'banned'
  | 'unbanned'
  | 'invitationRejected'
  | 'invitationRevoked';

export type MxStateChange = 'name' | 'topic' | 'avatar' | 'created' | 'encryption';

/** Only what the app renders; drivers drop the rest before it counts as a message. */
export type MxContent =
  | { kind: 'text'; body: string; html?: string; msgtype?: 'notice' | 'emote' }
  | ({ kind: 'image'; width?: number; height?: number; caption?: string } & MxMedia)
  | ({ kind: 'file'; caption?: string } & MxMedia)
  | ({ kind: 'audio'; durationMs?: number; voice: boolean } & MxMedia)
  | ({
      kind: 'video';
      width?: number;
      height?: number;
      durationMs?: number;
      caption?: string;
    } & MxMedia)
  | { kind: 'sticker'; body: string }
  | {
      kind: 'poll';
      question: string;
      answers: { id: string; text: string }[];
      votes: Record<string, string[]>;
      maxSelections: number;
      closed: boolean;
    }
  | { kind: 'location' }
  | { kind: 'redacted' }
  | { kind: 'undecryptable' }
  | { kind: 'membership'; change: MxMembershipChange; user: string; userName?: string }
  | { kind: 'state'; change: MxStateChange; value?: string };

export type MxTextOutgoing = { kind: 'text'; body: string; html?: string; mentions?: string[] };

export type MxOutgoing =
  | MxTextOutgoing
  | {
      kind: 'image';
      path: string;
      mimeType?: string;
      width?: number;
      height?: number;
      size?: number;
      caption?: string;
    }
  | { kind: 'file'; path: string; name: string; mimeType?: string; size?: number }
  | {
      kind: 'video';
      path: string;
      mimeType?: string;
      width?: number;
      height?: number;
      durationMs?: number;
      size?: number;
      caption?: string;
    }
  | { kind: 'voice'; path: string; durationMs: number; mimeType?: string; size?: number };

export type MxUpdate =
  | { type: 'room'; room: MxRoom }
  | { type: 'roomGone'; roomId: string }
  | { type: 'typing'; roomId: string; userIds: string[] }
  | { type: 'event'; event: MxEvent }
  /** The homeserver no longer accepts the session: signed out elsewhere, or the token expired. */
  | { type: 'signedOut' };

export interface MatrixApi {
  /** Restores the saved session when there is one; `null` means sign in first. Rooms arrive as updates. */
  start(params: MxStartParams): Promise<MxSession | null>;
  login(password: string): Promise<MxSession>;
  /** Ends the session on the homeserver. */
  logout(): Promise<void>;

  room(id: string): Promise<MxRoom | null>;
  /** Oldest first; `before` is an event id from a previous page. */
  messages(roomId: string, opts: { limit: number; before?: string }): Promise<MxEvent[]>;
  members(roomId: string): Promise<MxMember[]>;
  profile(userId: string): Promise<MxProfile | null>;
  previewPublicRoom(idOrAlias: string, via: string[]): Promise<MxPublicRoom>;
  joinPublicRoom(idOrAlias: string, via: string[]): Promise<string>;
  knockPublicRoom(idOrAlias: string, via: string[]): Promise<void>;

  createDm(userId: string): Promise<string>;
  createRoom(userIds: string[], name: string): Promise<string>;
  invite(roomId: string, userId: string): Promise<void>;
  kick(roomId: string, userId: string): Promise<void>;
  ban(roomId: string, userId: string): Promise<void>;
  setPowerLevel(roomId: string, userId: string, level: number): Promise<void>;
  setName(roomId: string, name: string): Promise<void>;
  join(roomId: string): Promise<void>;
  leave(roomId: string): Promise<void>;
  ignore(userId: string, ignored: boolean): Promise<void>;

  /** Resolves once the homeserver has the message; it then arrives as an `event` update. */
  send(roomId: string, content: MxOutgoing, replyTo?: string, threadRoot?: string): Promise<void>;
  edit(roomId: string, eventId: string, content: MxTextOutgoing): Promise<void>;
  redact(roomId: string, eventId: string): Promise<void>;
  pinnedMessages(roomId: string): Promise<MxEvent[]>;
  setPinned(roomId: string, eventId: string, pinned: boolean): Promise<void>;
  toggleReaction(roomId: string, eventId: string, key: string): Promise<void>;
  markRead(roomId: string): Promise<void>;
  setMarkedUnread(roomId: string, unread: boolean): Promise<void>;
  setTyping(roomId: string, typing: boolean): Promise<void>;
  createPoll(roomId: string, question: string, options: string[]): Promise<void>;
  votePoll(roomId: string, eventId: string, answerIds: string[]): Promise<void>;

  /** Downloads once and returns a local path the app can display. */
  media(media: MxMedia): Promise<string>;

  onUpdate(listener: (update: MxUpdate) => void): () => void;
  /** Stops syncing and frees the client. Local data survives. */
  close(): Promise<void>;
  /** Closes and deletes everything the SDK stored. */
  erase(): Promise<void>;
}
