import { useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { htmlToMarkdown } from '@/core/messaging/html-markdown';
import { markdownHtml } from '@/core/messaging/markdown';

import type { ComposerInputProps } from './composer-input';

export type { ComposerInputHandle, ComposerInputProps } from './composer-input';

const ZERO_WIDTH = '​';

const SHORTCUTS: Record<string, string> = { b: 'bold', i: 'italic', x: 'strikeThrough' };

/** Closing a Markdown pair while typing turns it into the formatting it stands for. */
const TYPED: [RegExp, string][] = [
  [/(\*\*|__)(\S(?:.*?\S)?)\1$/, 'strong'],
  [/(?<![*\w])([*_])([^*_\s](?:[^*_]*[^*_\s])?)\1$/, 'em'],
  [/(~~?)([^~\s](?:[^~]*[^~\s])?)\1$/, 's'],
  [/`([^`]+)`$/, 'code'],
];

const STYLE = `
.composer-rich { outline: none; white-space: pre-wrap; overflow-wrap: anywhere; }
.composer-rich code, .composer-rich pre {
  font-family: var(--font-mono), ui-monospace, monospace; font-size: 0.9em;
  background: rgb(var(--color-content) / 0.07); border-radius: 4px; padding: 0 3px;
}
.composer-rich pre { padding: 4px 8px; margin: 2px 0; }
.composer-rich blockquote {
  margin: 2px 0; padding-left: 8px; border-left: 2px solid rgb(var(--color-brand));
}
.composer-rich p, .composer-rich ul, .composer-rich ol { margin: 0; }
.composer-rich ul, .composer-rich ol { padding-left: 20px; }
.composer-rich a { color: rgb(var(--color-brand)); }
`;

/**
 * A rich-text field: the formatting shows as formatting, never as markers.
 * It speaks Markdown to the composer, as the phone's plain field does.
 */
export function ComposerInput({
  ref,
  value,
  onChangeText,
  onSubmit,
  onFile,
  placeholder,
  placeholderColor,
}: ComposerInputProps) {
  const field = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => focusAtEnd(field.current) }));

  useLayoutEffect(() => {
    const el = field.current;
    if (!el || value === shown.current) return;
    shown.current = value;
    el.innerHTML = toHtml(value);
    if (document.activeElement === el) focusAtEnd(el);
  }, [value]);

  const emit = (suffix = '') => {
    const el = field.current;
    if (!el) return;
    const plain = el.innerText.replace(/​/g, '');
    // Commands take their arguments as typed, so they skip the formatting.
    const text = plain.trimStart().startsWith('/')
      ? plain.replace(/\n$/, '')
      : htmlToMarkdown(el.innerHTML.replace(/​/g, ''));
    shown.current = text;
    onChangeText(text + suffix);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        document.execCommand('insertLineBreak');
        emit();
      } else {
        onSubmit();
      }
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      emit('\t');
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'e') {
      event.preventDefault();
      wrapSelection('code');
      emit();
    } else if (SHORTCUTS[key] && (key === 'x') === event.shiftKey) {
      event.preventDefault();
      document.execCommand(SHORTCUTS[key]);
      emit();
    }
  };

  const onInput = (event: React.FormEvent<HTMLDivElement>) => {
    const input = event.nativeEvent as InputEvent;
    if (input.inputType === 'insertText' && input.data && '*_~`'.includes(input.data)) {
      applyTypedMarkdown();
    }
    const el = field.current;
    if (el && el.innerText.trim() === '' && el.innerHTML !== '') el.innerHTML = '';
    emit();
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = [...event.clipboardData.files];
    if (files.length > 0 && onFile) {
      files.forEach(onFile);
      return;
    }
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (onFile) [...event.dataTransfer.files].forEach(onFile);
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, alignSelf: 'center' }}>
      <style>{STYLE}</style>
      {value === '' ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 10,
            left: 0,
            color: placeholderColor,
            pointerEvents: 'none',
          }}
          className="text-body">
          {placeholder}
        </div>
      ) : null}
      <div
        ref={field}
        data-testid="composer-input"
        role="textbox"
        aria-multiline
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onDragOver={(event) => {
          if (onFile && event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={onDrop}
        className="composer-rich text-body text-content"
        style={{ maxHeight: 128, minHeight: 22, overflowY: 'auto', padding: '10px 4px 10px 0' }}
      />
    </div>
  );
}

function toHtml(markdown: string): string {
  return (
    markdownHtml(markdown) ??
    markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  );
}

function focusAtEnd(el: HTMLElement | null) {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretAfter(node: Node) {
  const after = document.createTextNode(ZERO_WIDTH);
  node.parentNode?.insertBefore(after, node.nextSibling);
  const range = document.createRange();
  range.setStart(after, 1);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function wrapSelection(tag: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const element = document.createElement(tag);
  element.textContent = range.toString();
  range.deleteContents();
  range.insertNode(element);
  placeCaretAfter(element);
}

function applyTypedMarkdown() {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return;
  const offset = selection.anchorOffset;
  const before = (node.textContent ?? '').slice(0, offset);

  for (const [pattern, tag] of TYPED) {
    const match = pattern.exec(before);
    if (!match) continue;
    const inner = match[match.length - 1];
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, offset);
    range.deleteContents();
    const element = document.createElement(tag);
    element.textContent = inner;
    range.insertNode(element);
    placeCaretAfter(element);
    return;
  }
}
