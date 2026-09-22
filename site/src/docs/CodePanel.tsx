'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { ClipboardIcon } from '@/docs/icons/ClipboardIcon';

function CopyButton({ code }: { code: string }) {
  let [copyCount, setCopyCount] = useState(0);
  let copied = copyCount > 0;

  useEffect(() => {
    if (copyCount > 0) {
      let timeout = setTimeout(() => setCopyCount(0), 1000);
      return () => clearTimeout(timeout);
    }
  }, [copyCount]);

  return (
    <button
      type="button"
      className={clsx(
        'group/button absolute top-3.5 right-4 overflow-hidden rounded-full py-1 pr-3 pl-2 text-2xs font-medium opacity-0 backdrop-blur-sm transition group-hover:opacity-100 focus:opacity-100',
        copied
          ? 'bg-brand-400/10 ring-1 ring-brand-400/20 ring-inset'
          : 'bg-white/5 hover:bg-white/7.5 dark:bg-white/2.5 dark:hover:bg-white/5'
      )}
      onClick={() => {
        window.navigator.clipboard.writeText(code).then(() => {
          setCopyCount((count) => count + 1);
        });
      }}>
      <span
        aria-hidden={copied}
        className={clsx(
          'pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300',
          copied && '-translate-y-1.5 opacity-0'
        )}>
        <ClipboardIcon className="h-5 w-5 fill-zinc-500/20 stroke-zinc-500 transition-colors group-hover/button:stroke-zinc-400" />
        Copy
      </span>
      <span
        aria-hidden={!copied}
        className={clsx(
          'pointer-events-none absolute inset-0 flex items-center justify-center text-brand-300 transition duration-300',
          !copied && 'translate-y-1.5 opacity-0'
        )}>
        Copied!
      </span>
    </button>
  );
}

export function CodePanel({ language, code }: { language?: string; code: string }) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-md dark:ring-1 dark:ring-white/10">
      {language && (
        <div className="flex h-9 items-center border-b border-white/7.5 bg-zinc-800 px-4 dark:border-white/5 dark:bg-transparent">
          <span className="font-mono text-xs text-zinc-400">{language}</span>
        </div>
      )}
      <div className="group relative dark:bg-white/2.5">
        <pre className="overflow-x-auto p-4 text-xs/5 text-white">
          <code>{code}</code>
        </pre>
        <CopyButton code={code} />
      </div>
    </div>
  );
}
