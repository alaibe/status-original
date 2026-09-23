import * as sdk from '@unomed/react-native-matrix-sdk';

import type { MxContent, MxEvent, MxMedia, MxMembership, MxMembershipChange, MxRole } from '../api';

export function mapMembership(membership: sdk.Membership): MxMembership {
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

export function mapRole(role: sdk.RoomMemberRole): MxRole {
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

export function nameOf(profile: sdk.ProfileDetails): string | undefined {
  return profile.tag === sdk.ProfileDetails_Tags.Ready
    ? (profile.inner.displayName ?? undefined)
    : undefined;
}

export function sendState(state: sdk.EventSendState | undefined): MxEvent['status'] {
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

export function mapContent(content: sdk.TimelineItemContent): MxContent | null {
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
      return {
        kind: 'poll',
        question: kind.inner.question,
        answers: kind.inner.answers,
        votes: Object.fromEntries(kind.inner.votes),
        maxSelections: Number(kind.inner.maxSelections),
        closed: kind.inner.endTime !== undefined,
      };
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

function textOf(content: { body: string; formatted?: sdk.FormattedBody }) {
  const html =
    content.formatted?.format.tag === sdk.MessageFormat_Tags.Html
      ? content.formatted.body
      : undefined;
  return { body: content.body, html };
}

function mapMessage(type: sdk.MessageType): MxContent | null {
  switch (type.tag) {
    case sdk.MessageType_Tags.Text:
      return { kind: 'text', ...textOf(type.inner.content) };
    case sdk.MessageType_Tags.Notice:
      return { kind: 'text', ...textOf(type.inner.content), msgtype: 'notice' };
    case sdk.MessageType_Tags.Emote:
      return { kind: 'text', ...textOf(type.inner.content), msgtype: 'emote' };
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
    case sdk.MessageType_Tags.Video: {
      const c = type.inner.content;
      return {
        kind: 'video',
        ...media(c.source, c.filename, c.info?.mimetype, c.info?.size),
        width: c.info?.width === undefined ? undefined : Number(c.info.width),
        height: c.info?.height === undefined ? undefined : Number(c.info.height),
        durationMs: c.info?.duration,
        caption: c.caption,
      };
    }
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

export function extensionOf(name: string): string {
  const match = name.match(/\.[A-Za-z0-9]{1,5}$/);
  return match ? match[0].toLowerCase() : '';
}
