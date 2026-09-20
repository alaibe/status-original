import type { Unsubscribe } from './types';

export interface HistoryState {
  status: 'idle' | 'fetching' | 'partial' | 'error';
  error?: string;
}

export class PartialHistoryError extends Error {}

export function historyFailure(error: unknown): HistoryState {
  return {
    status: error instanceof PartialHistoryError ? 'partial' : 'error',
    error: error instanceof Error ? error.message : 'History could not be fetched',
  };
}

/** Counts overlapping backfills so the first finished topic cannot hide the rest. */
export class HistoryTracker {
  private pending = 0;
  private failure: HistoryState | undefined;
  private state: HistoryState = { status: 'idle' };
  private listeners = new Set<(state: HistoryState) => void>();

  subscribe(listener: (state: HistoryState) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending === 0) this.failure = undefined;
    this.pending++;
    this.publish({ status: 'fetching' });
    try {
      return await work();
    } catch (error) {
      if (this.failure?.status !== 'error') this.failure = historyFailure(error);
      throw error;
    } finally {
      this.pending--;
      if (this.pending === 0) {
        this.publish(this.failure ?? { status: 'idle' });
      }
    }
  }

  reportFailure(error: unknown): void {
    this.failure = historyFailure(error);
    if (this.pending === 0) this.publish(this.failure);
  }

  clearFailure(): void {
    this.failure = undefined;
    if (this.pending === 0) this.publish({ status: 'idle' });
  }

  private publish(state: HistoryState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
