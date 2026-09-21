import TdLib from 'react-native-tdlib';

import { TdRequestError, type TdApi, type TdError, type TdObject } from './api';

interface Pending {
  resolve(value: TdObject): void;
  reject(error: Error): void;
}

const EXTRA_PREFIX = 'so-';

let active: TdClient | null = null;

/**
 * Drives `td_json_client` directly instead of through the wrapper's
 * `startTdLib`, which pins the database to one shared directory with no
 * encryption key. Requests are correlated by `@extra`; everything else TDLib
 * emits is an update.
 *
 * The native module holds one client, so creating a new one closes the last.
 */
export class TdClient implements TdApi {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(update: TdObject) => void>();
  private state: 'open' | 'closing' | 'closed' = 'open';
  private resolveClosed: (() => void) | null = null;
  private readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  private constructor() {}

  static async create(): Promise<TdClient> {
    if (active) await active.close();
    await TdLib.td_json_client_create();
    const client = new TdClient();
    active = client;
    void client.receiveLoop();
    return client;
  }

  onUpdate(listener: (update: TdObject) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send<T extends TdObject = TdObject>(request: TdObject): Promise<T> {
    if (this.state !== 'open') return Promise.reject(new Error('TDLib client is closed'));
    const extra = `${EXTRA_PREFIX}${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(extra, { resolve: resolve as Pending['resolve'], reject });
      TdLib.td_json_client_send({ ...request, '@extra': extra }).catch((error: unknown) => {
        this.pending.delete(extra);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  close(): Promise<void> {
    return this.shutDown('close');
  }

  destroy(): Promise<void> {
    return this.shutDown('destroy');
  }

  private shutDown(how: 'close' | 'destroy'): Promise<void> {
    if (this.state === 'open') {
      this.state = 'closing';
      TdLib.td_json_client_send({ '@type': how }).catch(() => this.finishClose());
    }
    return this.closed;
  }

  private async receiveLoop(): Promise<void> {
    while (this.state !== 'closed') {
      let raw: string;
      try {
        raw = await TdLib.td_json_client_receive();
      } catch (error) {
        // The native call rejects on its own timeout when TDLib is idle.
        if (isNativeCode(error, 'RECEIVE_ERROR')) continue;
        await this.finishClose();
        break;
      }
      const response = JSON.parse(raw) as TdObject;
      this.dispatch(response);
      if (isClosedState(response)) {
        await this.finishClose();
        break;
      }
    }
  }

  /**
   * Only safe once TDLib has reported `authorizationStateClosed`: the receive
   * loop is the sole caller, so no receive is in flight on the freed client.
   */
  private async finishClose(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (active === this) active = null;
    try {
      await TdLib.td_json_client_destroy();
    } catch {}
    for (const { reject } of this.pending.values()) reject(new Error('TDLib client is closed'));
    this.pending.clear();
    this.resolveClosed?.();
  }

  private dispatch(response: TdObject): void {
    const extra = response['@extra'];
    if (typeof extra === 'string') {
      const pending = this.pending.get(extra);
      this.pending.delete(extra);
      if (!pending) return;
      if (response['@type'] === 'error') {
        const { code, message } = response as TdError;
        pending.reject(new TdRequestError(code, message));
      } else {
        pending.resolve(response);
      }
      return;
    }
    if (response['@type'].startsWith('update')) {
      for (const listener of this.listeners) listener(response);
    }
  }
}

function isClosedState(update: TdObject): boolean {
  return (
    update['@type'] === 'updateAuthorizationState' &&
    (update.authorization_state as TdObject | undefined)?.['@type'] === 'authorizationStateClosed'
  );
}

function isNativeCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
