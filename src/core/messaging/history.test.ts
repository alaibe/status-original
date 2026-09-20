import { HistoryTracker, type HistoryState } from './history';

it('keeps overlapping backfills visible and retains a failure until retry', async () => {
  const tracker = new HistoryTracker();
  let latest: HistoryState = { status: 'idle' };
  tracker.subscribe((state) => { latest = state; });
  let finish!: () => void;
  const slow = tracker.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  await expect(tracker.run(async () => { throw new Error('node unavailable'); })).rejects.toThrow();
  expect(latest.status).toBe('fetching');
  finish();
  await slow;
  expect(latest).toEqual({ status: 'error', error: 'node unavailable' });
  await tracker.run(async () => {});
  expect(latest).toEqual({ status: 'idle' });
});
