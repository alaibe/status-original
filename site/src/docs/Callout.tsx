import clsx from 'clsx';

function InfoIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="8" strokeWidth="0" />
      <path
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M6.75 7.75h1.5v3.5"
      />
      <circle cx="8" cy="4" r=".5" fill="none" />
    </svg>
  );
}

const styles = {
  note: {
    box: 'border-brand-500/20 bg-brand-50/50 text-brand-900 dark:border-brand-400/30 dark:bg-brand-400/5 dark:text-brand-100 dark:[--tw-prose-links:var(--color-white)]',
    icon: 'fill-brand-500 stroke-white dark:fill-brand-200/20 dark:stroke-brand-200',
  },
  warning: {
    box: 'border-amber-500/25 bg-amber-50/60 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/5 dark:text-amber-100 dark:[--tw-prose-links:var(--color-white)]',
    icon: 'fill-amber-500 stroke-white dark:fill-amber-200/20 dark:stroke-amber-200',
  },
};

export function Callout({
  type,
  title,
  children,
}: {
  type?: string;
  title?: string;
  children: React.ReactNode;
}) {
  let style = type === 'warning' || type === 'danger' ? styles.warning : styles.note;

  return (
    <div className={clsx('my-6 flex gap-2.5 rounded-2xl border p-4 text-sm/6', style.box)}>
      <InfoIcon className={clsx('mt-1 h-4 w-4 flex-none', style.icon)} />
      <div className="*:my-2 *:first:mt-0 *:last:mb-0 [&_strong]:text-inherit">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
