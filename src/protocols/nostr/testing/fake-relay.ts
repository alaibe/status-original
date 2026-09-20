import type { NostrEvent } from '../events';
import type { WebSocketLike } from '../relay-pool';

export class FakeRelay implements WebSocketLike {
  onopen: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  readonly sent: unknown[][] = [];
  readonly published: NostrEvent[] = [];
  readonly subscriptions = new Set<string>();

  closed = false;
  autoAcceptPublications = true;

  constructor(readonly url: string) {}

  open() {
    this.closed = false;
    this.onopen?.();
  }

  send(data: string) {
    const message = JSON.parse(data) as unknown[];
    this.sent.push(message);

    if (message[0] === 'REQ') this.subscriptions.add(message[1] as string);
    if (message[0] === 'CLOSE') this.subscriptions.delete(message[1] as string);
    if (message[0] === 'EVENT') {
      const event = message[1] as NostrEvent;
      this.published.push(event);
      if (this.autoAcceptPublications) {
        this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) });
      }
    }
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  deliver(subscriptionId: string, event: NostrEvent) {
    this.onmessage?.({ data: JSON.stringify(['EVENT', subscriptionId, event]) });
  }

  broadcast(event: NostrEvent) {
    for (const id of this.subscriptions) this.deliver(id, event);
  }

  eose(subscriptionId: string) {
    this.onmessage?.({ data: JSON.stringify(['EOSE', subscriptionId]) });
  }

  notice(text: string) {
    this.onmessage?.({ data: JSON.stringify(['NOTICE', text]) });
  }

  acknowledge(eventId: string, accepted: boolean, reason = '') {
    this.onmessage?.({ data: JSON.stringify(['OK', eventId, accepted, reason]) });
  }

  garbage() {
    this.onmessage?.({ data: 'not json at all' });
    this.onmessage?.({ data: JSON.stringify({ not: 'an array' }) });
    this.onmessage?.({ data: JSON.stringify(['SOMETHING_NEW', 'x']) });
  }
}

export function fakeRelayFactory() {
  const relays: FakeRelay[] = [];
  return {
    relays,
    byUrl: (url: string) => relays.find((r) => r.url === url),
    create(url: string): WebSocketLike {
      const relay = new FakeRelay(url);
      relays.push(relay);
      return relay;
    },
  };
}
