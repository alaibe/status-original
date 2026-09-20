import type { NostrEvent } from './events';

export type RelayStatus = 'connecting' | 'open' | 'closed';

export interface RelayState {
  url: string;
  status: RelayStatus;
  error?: string;
}

export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tagFilter: `#${string}`]: string[] | undefined;
}

export interface Subscription {
  id: string;
  filters: Filter[];
  onEvent(event: NostrEvent): unknown;
  onEose?(url: string): void;
}

export interface RelayPoolOptions {
  urls: string[];
  authenticate?(url: string, challenge: string): NostrEvent;
  onStatusChange?(states: RelayState[]): void;
  createSocket?(url: string): WebSocketLike;
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const SEEN_LIMIT = 5_000;
const PUBLISH_TIMEOUT_MS = 15_000;

interface PendingPublication {
  event: NostrEvent;
  waiting: Set<string>;
  authBlocked: Set<string>;
  failures: Map<string, string>;
  timer: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: Error): void;
}

interface Connection {
  url: string;
  socket: WebSocketLike | null;
  status: RelayStatus;
  error?: string;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  authChallenge?: string;
  authEventId?: string;
}

export class RelayPool {
  private connections = new Map<string, Connection>();
  private subscriptions = new Map<string, Subscription>();
  private seen = new Set<string>();
  private inFlight = new Set<string>();
  private publications = new Map<string, PendingPublication>();
  private closed = false;

  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly onStatusChange?: (states: RelayState[]) => void;
  private readonly authenticate?: RelayPoolOptions['authenticate'];

  constructor(options: RelayPoolOptions) {
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.onStatusChange = options.onStatusChange;
    this.authenticate = options.authenticate;

    for (const url of dedupeUrls(options.urls)) this.addRelay(url);
  }

  get states(): RelayState[] {
    return [...this.connections.values()].map((c) => ({
      url: c.url,
      status: c.status,
      error: c.error,
    }));
  }

  get openCount(): number {
    return [...this.connections.values()].filter((c) => c.status === 'open').length;
  }

  private addRelay(url: string) {
    if (this.connections.has(url)) return;
    const connection: Connection = {
      url,
      socket: null,
      status: 'connecting',
      attempts: 0,
      timer: null,
    };
    this.connections.set(url, connection);
    this.open(connection);
  }

  private open(connection: Connection) {
    if (this.closed) return;

    connection.status = 'connecting';
    connection.authChallenge = undefined;
    connection.authEventId = undefined;
    this.notify();

    let socket: WebSocketLike;
    try {
      socket = this.createSocket(connection.url);
    } catch (error) {
      connection.error = describe(error);
      this.scheduleReconnect(connection);
      return;
    }
    connection.socket = socket;

    socket.onopen = () => {
      connection.status = 'open';
      connection.attempts = 0;
      connection.error = undefined;
      this.notify();
      for (const subscription of this.subscriptions.values()) {
        this.sendTo(connection, ['REQ', subscription.id, ...subscription.filters]);
      }
    };

    socket.onmessage = (event) => {
      this.handleMessage(connection, event.data);
    };

    socket.onerror = (event) => {
      connection.error = describe(event);
    };

    socket.onclose = () => {
      this.failPublicationsFor(connection.url, 'Relay disconnected before acknowledging the event');
      connection.socket = null;
      connection.status = 'closed';
      this.notify();
      this.scheduleReconnect(connection);
    };
  }

  private scheduleReconnect(connection: Connection) {
    if (this.closed) return;
    if (connection.timer) clearTimeout(connection.timer);

    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** connection.attempts);
    connection.attempts = Math.min(connection.attempts + 1, 10);
    const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));

    connection.timer = setTimeout(() => {
      connection.timer = null;
      this.open(connection);
    }, delay);
  }

  private handleMessage(connection: Connection, raw: unknown) {
    if (typeof raw !== 'string') return;

    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== 'string') return;

    switch (message[0]) {
      case 'AUTH': {
        const challenge = message[1];
        if (!this.authenticate || typeof challenge !== 'string' || connection.authChallenge === challenge) return;
        connection.authChallenge = challenge;
        try {
          const event = this.authenticate(connection.url, challenge);
          connection.authEventId = event.id;
          // Authentication belongs to this socket, never to the public event feed.
          this.sendTo(connection, ['AUTH', event]);
        } catch (error) {
          connection.error = describe(error);
          this.notify();
        }
        return;
      }
      case 'OK': {
        const eventId = message[1];
        const publication = typeof eventId === 'string' ? this.publications.get(eventId) : undefined;
        if (publication) {
          if (message[2] === true) {
            this.finishPublication(eventId);
          } else {
            const reason = String(message[3] || 'Relay rejected the event');
            if (/auth/i.test(reason) && connection.authEventId) {
              publication.authBlocked.add(connection.url);
            }
            else this.failPublicationRelay(eventId, connection.url, reason);
          }
          return;
        }

        if (!connection.authEventId || eventId !== connection.authEventId) return;
        connection.authEventId = undefined;
        if (message[2] === true) {
          connection.error = undefined;
          // AUTH does not reopen the DM requests rejected before authentication.
          for (const subscription of this.subscriptions.values()) {
            this.sendTo(connection, ['REQ', subscription.id, ...subscription.filters]);
          }
          for (const pending of this.publications.values()) {
            if (!pending.authBlocked.delete(connection.url)) continue;
            if (!this.sendTo(connection, ['EVENT', pending.event])) {
              this.failPublicationRelay(pending.event.id, connection.url, 'Relay write failed after authentication');
            }
          }
        } else {
          connection.error = String(message[3] || 'Relay authentication failed');
          for (const pending of [...this.publications.values()]) {
            if (pending.authBlocked.has(connection.url)) {
              this.failPublicationRelay(pending.event.id, connection.url, connection.error);
            }
          }
        }
        this.notify();
        return;
      }
      case 'EVENT': {
        const [, subscriptionId, event] = message as [string, string, NostrEvent];
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription || !event?.id) return;
        if (this.seen.has(event.id) || this.inFlight.has(event.id)) return;
        this.inFlight.add(event.id);
        Promise.resolve(subscription.onEvent(event))
          .then(() => this.remember(event.id))
          .catch(() => {})
          .finally(() => this.inFlight.delete(event.id));
        return;
      }
      case 'EOSE': {
        const [, subscriptionId] = message as [string, string];
        this.subscriptions.get(subscriptionId)?.onEose?.(connection.url);
        return;
      }
      case 'NOTICE':
      case 'CLOSED': {
        connection.error = String(message[message.length - 1] ?? '');
        this.notify();
        return;
      }
      default:
        return;
    }
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
  }

  subscribe(subscription: Subscription): () => void {
    this.subscriptions.set(subscription.id, subscription);
    for (const connection of this.connections.values()) {
      if (connection.status === 'open') {
        this.sendTo(connection, ['REQ', subscription.id, ...subscription.filters]);
      }
    }

    return () => {
      this.subscriptions.delete(subscription.id);
      for (const connection of this.connections.values()) {
        if (connection.status === 'open') this.sendTo(connection, ['CLOSE', subscription.id]);
      }
    };
  }

  publish(event: NostrEvent): Promise<void> {
    if (this.publications.has(event.id)) {
      return Promise.reject(new Error(`Event ${event.id} is already awaiting relay acceptance`));
    }

    const open = [...this.connections.values()].filter((connection) => connection.status === 'open');
    if (open.length === 0) {
      return Promise.reject(new Error('No relay accepted the event because none is connected'));
    }

    return new Promise<void>((resolve, reject) => {
      const pending: PendingPublication = {
        event,
        waiting: new Set(open.map((connection) => connection.url)),
        authBlocked: new Set(),
        failures: new Map(),
        timer: setTimeout(() => {
          this.rejectPublication(event.id, new Error('Nostr relay acknowledgment timed out'));
        }, PUBLISH_TIMEOUT_MS),
        resolve,
        reject,
      };
      this.publications.set(event.id, pending);

      for (const connection of open) {
        if (!this.sendTo(connection, ['EVENT', event])) {
          this.failPublicationRelay(event.id, connection.url, 'Relay socket write failed');
        }
      }
    });
  }

  private finishPublication(eventId: string) {
    const pending = this.publications.get(eventId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.publications.delete(eventId);
    pending.resolve();
  }

  private rejectPublication(eventId: string, error: Error) {
    const pending = this.publications.get(eventId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.publications.delete(eventId);
    pending.reject(error);
  }

  private failPublicationRelay(eventId: string, url: string, reason: string) {
    const pending = this.publications.get(eventId);
    if (!pending || !pending.waiting.delete(url)) return;
    pending.authBlocked.delete(url);
    pending.failures.set(url, reason);
    if (pending.waiting.size === 0) {
      this.rejectPublication(eventId, new Error([...pending.failures.values()].join('; ')));
    }
  }

  private failPublicationsFor(url: string, reason: string) {
    for (const eventId of [...this.publications.keys()]) {
      this.failPublicationRelay(eventId, url, reason);
    }
  }

  private sendTo(connection: Connection, message: unknown[]): boolean {
    try {
      connection.socket?.send(JSON.stringify(message));
      return connection.socket !== null;
    } catch (error) {
      connection.error = describe(error);
      return false;
    }
  }

  setRelays(urls: string[]) {
    const next = new Set(dedupeUrls(urls));

    for (const [url, connection] of this.connections) {
      if (next.has(url)) continue;
      this.failPublicationsFor(url, 'Relay removed before acknowledging the event');
      this.teardown(connection);
      this.connections.delete(url);
    }
    for (const url of next) this.addRelay(url);
    this.notify();
  }

  close() {
    this.closed = true;
    for (const eventId of [...this.publications.keys()]) {
      this.rejectPublication(eventId, new Error('Nostr relay pool closed before acknowledging the event'));
    }
    this.subscriptions.clear();
    for (const connection of this.connections.values()) this.teardown(connection);
    this.connections.clear();
  }

  private teardown(connection: Connection) {
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = null;
    const socket = connection.socket;
    connection.socket = null;
    connection.status = 'closed';
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
      }
    }
  }

  private notify() {
    this.onStatusChange?.(this.states);
  }
}

export function dedupeUrls(urls: string[]): string[] {
  const out = new Map<string, string>();
  for (const raw of urls) {
    const url = normalizeRelayUrl(raw);
    if (url) out.set(url, url);
  }
  return [...out.values()];
}

export function normalizeRelayUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `wss://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message: unknown }).message);
  }
  return 'Relay error';
}
