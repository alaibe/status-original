import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
} from './api';

const UPDATE_EVENT = 'matrix://update';

/** The same crate as the phone, driven through `src-tauri/src/matrix.rs`. */
class TauriMatrixClient implements MatrixApi {
  private readonly listeners = new Set<(update: MxUpdate) => void>();
  private unlisten: Promise<UnlistenFn> | null = null;

  async start(params: MxStartParams): Promise<MxSession | null> {
    this.unlisten ??= listen<MxUpdate>(UPDATE_EVENT, (event) => {
      for (const listener of this.listeners) listener(event.payload);
    });
    await this.unlisten;
    return invoke<MxSession | null>('mx_start', { params });
  }

  login(password: string): Promise<MxSession> {
    return invoke('mx_login', { password });
  }

  logout(): Promise<void> {
    return invoke('mx_logout');
  }

  room(id: string): Promise<MxRoom | null> {
    return invoke('mx_room', { id });
  }

  messages(roomId: string, opts: { limit: number; before?: string }): Promise<MxEvent[]> {
    return invoke('mx_messages', { roomId, limit: opts.limit, before: opts.before });
  }

  members(roomId: string): Promise<MxMember[]> {
    return invoke('mx_members', { roomId });
  }

  profile(userId: string): Promise<MxProfile | null> {
    return invoke('mx_profile', { userId });
  }

  previewPublicRoom(idOrAlias: string, via: string[]): Promise<MxPublicRoom> {
    return invoke('mx_preview_public_room', { idOrAlias, via });
  }

  joinPublicRoom(idOrAlias: string, via: string[]): Promise<string> {
    return invoke('mx_join_public_room', { idOrAlias, via });
  }

  knockPublicRoom(idOrAlias: string, via: string[]): Promise<void> {
    return invoke('mx_knock_public_room', { idOrAlias, via });
  }

  createDm(userId: string): Promise<string> {
    return invoke('mx_create_dm', { userId });
  }

  createRoom(userIds: string[], name: string): Promise<string> {
    return invoke('mx_create_room', { userIds, name });
  }

  invite(roomId: string, userId: string): Promise<void> {
    return invoke('mx_invite', { roomId, userId });
  }

  kick(roomId: string, userId: string): Promise<void> {
    return invoke('mx_kick', { roomId, userId });
  }

  ban(roomId: string, userId: string): Promise<void> {
    return invoke('mx_ban', { roomId, userId });
  }

  setPowerLevel(roomId: string, userId: string, level: number): Promise<void> {
    return invoke('mx_set_power_level', { roomId, userId, level });
  }

  setName(roomId: string, name: string): Promise<void> {
    return invoke('mx_set_name', { roomId, name });
  }

  join(roomId: string): Promise<void> {
    return invoke('mx_join', { roomId });
  }

  leave(roomId: string): Promise<void> {
    return invoke('mx_leave', { roomId });
  }

  ignore(userId: string, ignored: boolean): Promise<void> {
    return invoke('mx_ignore', { userId, ignored });
  }

  send(roomId: string, content: MxOutgoing, replyTo?: string): Promise<void> {
    return invoke('mx_send', { roomId, content, replyTo });
  }

  toggleReaction(roomId: string, eventId: string, key: string): Promise<void> {
    return invoke('mx_toggle_reaction', { roomId, eventId, key });
  }

  redact(roomId: string, eventId: string): Promise<void> {
    return invoke('mx_redact', { roomId, eventId });
  }

  pinnedMessages(roomId: string): Promise<MxEvent[]> {
    return invoke('mx_pinned_messages', { roomId });
  }

  setPinned(roomId: string, eventId: string, pinned: boolean): Promise<void> {
    return invoke('mx_set_pinned', { roomId, eventId, pinned });
  }

  edit(roomId: string, eventId: string, content: MxTextOutgoing): Promise<void> {
    return invoke('mx_edit', { roomId, eventId, content });
  }

  markRead(roomId: string): Promise<void> {
    return invoke('mx_mark_read', { roomId });
  }

  setMarkedUnread(roomId: string, unread: boolean): Promise<void> {
    return invoke('mx_set_marked_unread', { roomId, unread });
  }

  setTyping(roomId: string, typing: boolean): Promise<void> {
    return invoke('mx_set_typing', { roomId, typing });
  }

  createPoll(roomId: string, question: string, options: string[]): Promise<void> {
    return invoke('mx_create_poll', { roomId, question, options });
  }

  votePoll(roomId: string, eventId: string, answerIds: string[]): Promise<void> {
    return invoke('mx_vote_poll', { roomId, eventId, answerIds });
  }

  media(media: MxMedia): Promise<string> {
    return invoke('mx_media', { media });
  }

  onUpdate(listener: (update: MxUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await invoke('mx_close');
    await this.release();
  }

  async erase(): Promise<void> {
    await invoke('mx_erase');
    await this.release();
  }

  private async release(): Promise<void> {
    this.listeners.clear();
    const unlisten = await this.unlisten;
    this.unlisten = null;
    unlisten?.();
  }
}

export const MatrixClient = {
  create: async (): Promise<MatrixApi> => new TauriMatrixClient(),
};
