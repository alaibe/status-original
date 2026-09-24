export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class UnsupportedError extends Error {
  constructor(message = 'This network does not support that.') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export class NotConnectedError extends Error {
  constructor(
    readonly protocol: string,
    message = `${protocol} is not connected.`
  ) {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message) return humanize(error.message, error);
  if (typeof error === 'string' && error) return humanize(error);
  return fallback;
}

function humanize(message: string, error?: Error): string {
  const first = message.split('\n')[0].trim();

  if (/HTTP request failed|fetch failed|Network request failed/i.test(message)) {
    return 'Could not reach the network. Check your connection, or point this chain at your own endpoint with /rpc.';
  }
  if (/timed? ?out/i.test(first)) {
    return 'The endpoint did not answer in time. Try again, or use /rpc to pick another.';
  }
  if ((error instanceof HttpError && error.status === 429) || /rate ?limit|429/i.test(message)) {
    return 'The public endpoint is rate-limiting this device. /rpc points it at your own.';
  }

  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}
