/** A vector diff from the SDK, as both the room list and timelines deliver them. */
export type VectorDiff<T> =
  | { tag: 'Append' | 'Reset'; inner: { values: T[] } }
  | { tag: 'PushFront' | 'PushBack'; inner: { value: T } }
  | { tag: 'Insert' | 'Set'; inner: { index: number; value: T } }
  | { tag: 'Remove'; inner: { index: number } }
  | { tag: 'Truncate'; inner: { length: number } }
  | { tag: 'Clear' | 'PopFront' | 'PopBack' };

/**
 * Applies one diff in place. `changed` holds items worth reporting; with
 * `newOnly`, bulk loads (initial items, pagination) are applied silently.
 */
export function applyDiff<T>(
  items: T[],
  diff: VectorDiff<T>,
  newOnly = false
): { changed: T[]; removed: T[] } {
  switch (diff.tag) {
    case 'Append':
      items.push(...diff.inner.values);
      return { changed: newOnly ? [] : diff.inner.values, removed: [] };
    case 'Reset': {
      const removed = items.splice(0, items.length, ...diff.inner.values);
      return { changed: newOnly ? [] : diff.inner.values, removed: newOnly ? [] : removed };
    }
    case 'Clear':
      return { changed: [], removed: items.splice(0, items.length) };
    case 'PushFront':
      items.unshift(diff.inner.value);
      return { changed: newOnly ? [] : [diff.inner.value], removed: [] };
    case 'PushBack':
      items.push(diff.inner.value);
      return { changed: [diff.inner.value], removed: [] };
    case 'PopFront':
      return { changed: [], removed: items.splice(0, 1) };
    case 'PopBack':
      return { changed: [], removed: items.splice(-1, 1) };
    case 'Insert': {
      items.splice(diff.inner.index, 0, diff.inner.value);
      const atEnd = diff.inner.index === items.length - 1;
      return { changed: !newOnly || atEnd ? [diff.inner.value] : [], removed: [] };
    }
    case 'Set': {
      const removed = items.splice(diff.inner.index, 1, diff.inner.value);
      return { changed: [diff.inner.value], removed: newOnly ? [] : removed };
    }
    case 'Remove':
      return { changed: [], removed: items.splice(diff.inner.index, 1) };
    case 'Truncate':
      return { changed: [], removed: items.splice(diff.inner.length) };
  }
}
