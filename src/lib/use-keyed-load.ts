import { useEffect, useEffectEvent, useState } from 'react';

interface Loaded<T> {
  key: string;
  value?: T;
  error?: unknown;
}

/**
 * What `load` returned for `key`, or the error it threw. A result that arrives
 * after the key changed is dropped; `version` reloads the same key.
 */
export function useKeyedLoad<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
  version?: string | number
) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    run(key).then(
      (value) => !cancelled && setLoaded({ key, value }),
      (error: unknown) => !cancelled && setLoaded({ key, error })
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const current = key !== null && loaded?.key === key ? loaded : undefined;
  return {
    value: current?.value,
    error: current?.error,
    loading: key !== null && current === undefined,
    update(change: (value: T) => T) {
      setLoaded((state) =>
        state && state.key === key && state.value !== undefined
          ? { ...state, value: change(state.value) }
          : state
      );
    },
  };
}
