import type { WakuRestMessage } from '../rest';

export class FakeWakuNode {
  private readonly buffers = new Map<string, WakuRestMessage[]>();
  private readonly stored: WakuRestMessage[] = [];

  readonly subscriptions = new Set<string>();
  readonly published: WakuRestMessage[] = [];

  down = false;
  hasStore = true;
  storePageSize = 100;
  publishAttempts = 0;
  readonly failPublishAttempts = new Set<number>();
  readonly historyQueries: URL[] = [];

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (this.down) throw new TypeError('Network request failed');

    if (path === '/debug/v1/info') return json({ listenAddresses: [] });

    if (path === '/relay/v1/auto/subscriptions') {
      const topics = JSON.parse(String(init?.body ?? '[]')) as string[];
      for (const topic of topics) {
        if (method === 'DELETE') this.subscriptions.delete(topic);
        else this.subscriptions.add(topic);
      }
      return json('OK');
    }

    if (path === '/relay/v1/auto/messages' && method === 'POST') {
      this.publishAttempts += 1;
      if (this.failPublishAttempts.delete(this.publishAttempts)) {
        return new Response('publish failed', { status: 503 });
      }
      const message = JSON.parse(String(init?.body ?? '{}')) as WakuRestMessage;
      this.published.push(message);
      this.stored.push(message);
      if (this.subscriptions.has(message.contentTopic)) {
        const buffer = this.buffers.get(message.contentTopic) ?? [];
        buffer.push(message);
        this.buffers.set(message.contentTopic, buffer);
      }
      return json('OK');
    }

    if (path.startsWith('/relay/v1/auto/messages/') && method === 'GET') {
      const topic = decodeURIComponent(path.slice('/relay/v1/auto/messages/'.length));
      const buffer = this.buffers.get(topic) ?? [];
      this.buffers.set(topic, []);
      return json(buffer);
    }

    if (path === '/store/v3/messages') {
      if (!this.hasStore) return new Response('no store', { status: 404 });
      this.historyQueries.push(url);
      const topics = (url.searchParams.get('contentTopics') ?? '').split(',');
      const startTime = Number(url.searchParams.get('startTime') ?? 0);
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 100), this.storePageSize);
      const matching = this.stored.filter((message) =>
        topics.includes(message.contentTopic) &&
        (message.timestamp === undefined || message.timestamp >= startTime)
      );
      const page = matching.slice(offset, offset + pageSize);
      const next = offset + page.length;
      return json({
        messages: page.map((message) => ({ message })),
        ...(next < matching.length ? { paginationCursor: String(next) } : {}),
      });
    }

    return new Response('not found', { status: 404 });
  };

  deliver(message: WakuRestMessage) {
    this.stored.push(message);
    const buffer = this.buffers.get(message.contentTopic) ?? [];
    buffer.push(message);
    this.buffers.set(message.contentTopic, buffer);
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
