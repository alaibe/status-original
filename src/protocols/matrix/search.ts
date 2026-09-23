import type { MxEvent } from './api';
import type { Homeserver } from './homeserver';

const LIMIT = 50;

interface RawEvent {
  event_id: string;
  room_id: string;
  sender: string;
  origin_server_ts: number;
  type: string;
  content: {
    msgtype?: string;
    body?: string;
    format?: string;
    formatted_body?: string;
    'm.relates_to'?: { rel_type?: string };
  };
}

const MSGTYPES: Record<string, 'notice' | 'emote'> = { 'm.notice': 'notice', 'm.emote': 'emote' };

/** Reaches only rooms the homeserver can read; encrypted history is left to what this device holds. */
export async function searchHomeserver(
  homeserver: Homeserver,
  term: string,
  selfId: string,
  roomId?: string
): Promise<MxEvent[]> {
  const found = await homeserver.request<{
    search_categories: { room_events?: { results?: { result: RawEvent }[] } };
  }>('POST', '/search', {
    search_categories: {
      room_events: {
        search_term: term,
        order_by: 'recent',
        filter: { limit: LIMIT, ...(roomId ? { rooms: [roomId] } : {}) },
      },
    },
  });
  return (found.search_categories.room_events?.results ?? []).flatMap(({ result }) => {
    const event = toEvent(result, selfId);
    return event ? [event] : [];
  });
}

function toEvent(raw: RawEvent, selfId: string): MxEvent | null {
  const { content } = raw;
  const msgtype = content.msgtype ? MSGTYPES[content.msgtype] : undefined;
  if (raw.type !== 'm.room.message' || (content.msgtype !== 'm.text' && !msgtype)) return null;
  if (content['m.relates_to']?.rel_type === 'm.replace') return null;
  return {
    id: raw.event_id,
    roomId: raw.room_id,
    sender: raw.sender,
    timestamp: raw.origin_server_ts,
    isOwn: raw.sender === selfId,
    status: 'sent',
    content: {
      kind: 'text',
      body: content.body ?? '',
      ...(content.format === 'org.matrix.custom.html' && content.formatted_body
        ? { html: content.formatted_body }
        : {}),
      ...(msgtype ? { msgtype } : {}),
    },
  };
}
