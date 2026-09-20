import { Observe } from 'expo-observe';

/** For errors the app recovers from, which the crash handler and error boundary never see. */
export function reportError(error: unknown): void {
  try {
    Observe.reportError(error);
  } catch {}
}
