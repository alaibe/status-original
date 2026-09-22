import clsx from 'clsx';

import { basePath } from '@/lib/site';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <img src={`${basePath}/logomark.svg`} alt="" className="h-full w-auto rounded-[23%]" />
      <span className="text-sm font-semibold text-zinc-900 dark:text-white">Status Original</span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400">Guide</span>
    </span>
  );
}
