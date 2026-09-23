import type { JoinRequest } from '@/core/messaging/protocol';

import type { MxRoom } from './api';
import type { Homeserver } from './homeserver';
import { permalink, serverName } from './ids';

interface MemberEvent {
  state_key: string;
  origin_server_ts: number;
  content: { displayname?: string; reason?: string };
}

export async function knocks(homeserver: Homeserver, roomId: string): Promise<JoinRequest[]> {
  const { chunk } = await homeserver.request<{ chunk: MemberEvent[] }>(
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/members?membership=knock`
  );
  return chunk.map((event) => ({
    userId: event.state_key,
    name: event.content.displayname || event.state_key,
    ...(event.content.reason ? { bio: event.content.reason } : {}),
    requestedAt: event.origin_server_ts,
  }));
}

/**
 * A matrix.to link to the room. A link that needs approval turns the room's
 * join rule to "knock"; a plain one works only where anyone may join.
 */
export async function inviteLink(
  homeserver: Homeserver,
  room: MxRoom,
  selfId: string,
  requiresApproval: boolean
): Promise<string> {
  const path = `/rooms/${encodeURIComponent(room.id)}/state/m.room.join_rules`;
  const { join_rule } = await homeserver
    .request<{ join_rule?: string }>('GET', path)
    .catch(() => ({ join_rule: undefined }));
  if (requiresApproval && join_rule !== 'knock')
    await homeserver.request('PUT', path, { join_rule: 'knock' });
  if (!requiresApproval && join_rule !== 'public')
    throw new Error(
      'Only invited people can join this room. Create a link that needs approval instead.'
    );
  return permalink(room.canonicalAlias ?? room.id, serverName(selfId));
}
