import { HttpError } from '@/core/errors';

export async function jsonRpc<T>(
  url: string,
  method: string,
  params: unknown[],
  { onStatus }: { onStatus?: (status: number) => string | undefined } = {}
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      onStatus?.(response.status) ?? `${method} failed (${response.status})`
    );
  }

  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  if (body.result === undefined) throw new Error(`${method} returned nothing`);
  return body.result;
}
