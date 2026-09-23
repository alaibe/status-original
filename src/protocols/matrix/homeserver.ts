export const CLIENT_API = '/_matrix/client/v3';

export class Homeserver {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly prefix = CLIENT_API
  ) {}

  at(prefix: string): Homeserver {
    return new Homeserver(this.baseUrl, this.accessToken, prefix);
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${this.prefix}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: { error?: string } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {}
    if (!response.ok) throw new Error(json.error ?? `The homeserver answered ${response.status}.`);
    return json as T;
  }
}
