import { Buffer } from 'buffer';

// The Ledger libraries build APDUs with Node's Buffer.
globalThis.Buffer ??= Buffer;

/**
 * The window's own right-click menu (Back, Reload, Inspect) makes no sense in
 * a messenger. Text fields keep it: that is where copy and paste live.
 */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, [contenteditable]') !== null;
}

document.addEventListener('contextmenu', (event) => {
  if (!editable(event.target)) event.preventDefault();
});

// ⌘R reloads the page during development; the window has no menu item for it.
if (__DEV__) {
  document.addEventListener(
    'keydown',
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        location.reload();
      }
    },
    true
  );
}
