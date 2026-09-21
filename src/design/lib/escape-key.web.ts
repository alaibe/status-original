import { useEffect, useEffectEvent } from 'react';

// Open overlays, innermost last; Esc reaches only the top one.
const stack: (() => void)[] = [];

function onKey(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (event.key !== 'Escape' || !top) return;
  event.preventDefault();
  top();
}

// Capture phase: react-native-web stops keydown from bubbling out of inputs.
function listen(handler: () => void) {
  if (stack.length === 0) globalThis.addEventListener('keydown', onKey, true);
  stack.push(handler);
  return () => {
    stack.splice(stack.indexOf(handler), 1);
    if (stack.length === 0) globalThis.removeEventListener('keydown', onKey, true);
  };
}

export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const escape = useEffectEvent(onEscape);
  useEffect(() => (active ? listen(() => escape()) : undefined), [active]);
}
