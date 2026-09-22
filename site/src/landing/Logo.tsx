import clsx from 'clsx';

import { basePath } from '@/lib/site';

export function Logomark({ className }: { className?: string }) {
  return (
    <img src={`${basePath}/logomark.svg`} alt="" className={clsx('rounded-[23%]', className)} />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-3', className)}>
      <Logomark className="h-full w-auto" />
      <span className="text-lg font-semibold tracking-tight text-gray-900">Status Original</span>
    </span>
  );
}
