import type { Unsubscribe } from '@/core/messaging/types';

import type { Homeserver } from './homeserver';

const POLL_MS = 60_000;

export interface Presence {
  online: boolean;
  lastSeenAt?: number;
}

interface Watched {
  count: number;
  timer: ReturnType<typeof setInterval>;
}

/**
 * Sliding sync carries no presence, so a user's status is asked of the
 * homeserver while someone is looking at it. A server with presence off
 * answers "offline" with no time, which shows nothing.
 */
export class PresenceWatcher {
  private readonly known = new Map<string, Presence>();
  private readonly watched = new Map<string, Watched>();

  constructor(
    private readonly homeserver: () => Homeserver | null,
    private readonly onChange: (userId: string) => void
  ) {}

  get(userId: string): Presence | undefined {
    return this.known.get(userId);
  }

  watch(userId: string): Unsubscribe {
    const current = this.watched.get(userId);
    if (current) current.count++;
    else {
      void this.poll(userId);
      this.watched.set(userId, {
        count: 1,
        timer: setInterval(() => void this.poll(userId), POLL_MS),
      });
    }
    return () => {
      const entry = this.watched.get(userId);
      if (!entry || --entry.count > 0) return;
      clearInterval(entry.timer);
      this.watched.delete(userId);
    };
  }

  clear(): void {
    for (const { timer } of this.watched.values()) clearInterval(timer);
    this.watched.clear();
    this.known.clear();
  }

  private async poll(userId: string): Promise<void> {
    const homeserver = this.homeserver();
    if (!homeserver) return;
    try {
      const status = await homeserver.request<{
        presence: 'online' | 'unavailable' | 'offline';
        last_active_ago?: number;
        currently_active?: boolean;
      }>('GET', `/presence/${encodeURIComponent(userId)}/status`);
      const online = status.presence === 'online' && status.currently_active !== false;
      const next: Presence = {
        online,
        ...(!online && status.last_active_ago !== undefined
          ? { lastSeenAt: Math.round((Date.now() - status.last_active_ago) / 60_000) * 60_000 }
          : {}),
      };
      const previous = this.known.get(userId);
      this.known.set(userId, next);
      if (previous?.online !== next.online || previous?.lastSeenAt !== next.lastSeenAt)
        this.onChange(userId);
    } catch {}
  }
}
