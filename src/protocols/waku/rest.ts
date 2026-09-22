import { HttpError } from '@/core/errors';

export interface WakuRestMessage {
  payload: string;
  contentTopic: string;
  version?: number;
  timestamp?: number;
  ephemeral?: boolean;
}

export interface WakuRestOptions {
  nodeUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class WakuRestClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WakuRestOptions) {
    this.base = options.nodeUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(this.base)) {
      throw new Error('The Waku node URL must start with http:// or https://');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async info(): Promise<unknown> {
    return this.request('GET', '/debug/v1/info');
  }

  async subscribe(contentTopics: string[]): Promise<void> {
    if (contentTopics.length === 0) return;
    await this.request('POST', '/relay/v1/auto/subscriptions', contentTopics);
  }

  async unsubscribe(contentTopics: string[]): Promise<void> {
    if (contentTopics.length === 0) return;
    await this.request('DELETE', '/relay/v1/auto/subscriptions', contentTopics);
  }

  async poll(contentTopic: string): Promise<WakuRestMessage[]> {
    const path = `/relay/v1/auto/messages/${encodeURIComponent(contentTopic)}`;
    const body = await this.request('GET', path);
    return Array.isArray(body) ? (body as WakuRestMessage[]) : [];
  }

  async publish(message: WakuRestMessage): Promise<void> {
    await this.request('POST', '/relay/v1/auto/messages', {
      payload: message.payload,
      contentTopic: message.contentTopic,
      version: message.version ?? 0,
      timestamp: message.timestamp ?? Date.now() * 1_000_000,
    });
  }

  async history(
    contentTopics: string[],
    opts: { pageSize?: number; cursor?: string; startTime?: number } = {}
  ): Promise<{ messages: WakuRestMessage[]; cursor?: string }> {
    if (contentTopics.length === 0) return { messages: [] };

    // No `pubsubTopic`. Relay goes through `/auto/`, where the node derives the
    // shard from the content topic; pinning the store query to one shard means
    // live messages arrive and the same conversation reloads empty.
    const params = new URLSearchParams({
      contentTopics: contentTopics.join(','),
      pageSize: String(opts.pageSize ?? 100),
      ascending: 'true',
      includeData: 'true',
    });
    if (opts.cursor) params.set('cursor', opts.cursor);
    // Waku timestamps are nanoseconds. Asking from where we left off keeps a
    // long absence from re-reading the whole topic from the beginning.
    if (opts.startTime !== undefined) {
      params.set('startTime', String(Math.floor(opts.startTime) * 1_000_000));
    }

    const body = (await this.request('GET', `/store/v3/messages?${params.toString()}`)) as {
      messages?: { message?: WakuRestMessage; messageHash?: string }[];
      paginationCursor?: string;
    } | null;

    const messages = (body?.messages ?? [])
      .map((entry) => entry.message)
      .filter((m): m is WakuRestMessage => Boolean(m?.payload));

    return { messages, cursor: body?.paginationCursor };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!response.ok) {
        throw new HttpError(
          response.status,
          `Waku node returned ${response.status} for ${method} ${path}`
        );
      }

      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Waku node did not respond within ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
