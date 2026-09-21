export interface TdObject {
  '@type': string;
  [key: string]: unknown;
}

export interface TdError extends TdObject {
  '@type': 'error';
  code: number;
  message: string;
}

export class TdRequestError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'TdRequestError';
  }
}

/** What the adapter needs from TDLib; the fake in `testing/` implements it too. */
export interface TdApi {
  send<T extends TdObject = TdObject>(request: TdObject): Promise<T>;
  onUpdate(listener: (update: TdObject) => void): () => void;
  /** Flushes TDLib's databases and frees the client. Local data survives. */
  close(): Promise<void>;
  /** Closes TDLib and deletes everything it stored. */
  destroy(): Promise<void>;
}
