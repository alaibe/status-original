import type { AccountStorage } from './account';

export function deferredWrite<T>(key: string, delayMs: number) {
  let pending: { storage: AccountStorage; value: T; timer: ReturnType<typeof setTimeout> } | null =
    null;

  const flush = (): Promise<void> => {
    if (!pending) return Promise.resolve();
    const { storage, value, timer } = pending;
    pending = null;
    clearTimeout(timer);
    return storage
      .set(key, value)
      .catch((error) => console.warn(`[storage] could not save ${key}`, error));
  };

  const saveSoon = (storage: AccountStorage, value: T): void => {
    if (pending && pending.storage !== storage) void flush();
    if (pending) clearTimeout(pending.timer);
    pending = { storage, value, timer: setTimeout(flush, delayMs) };
  };

  return { saveSoon, flush };
}
