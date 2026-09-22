import type { Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import Link from 'next/link';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import { Callout } from '@/docs/Callout';
import { Heading } from '@/docs/Heading';

type Props<T extends keyof React.JSX.IntrinsicElements> = React.ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

function Anchor({ href = '', node: _, ...props }: Props<'a'>) {
  if (/^[a-z]+:/i.test(href)) {
    return <a href={href} target="_blank" rel="noreferrer" {...props} />;
  }
  return <Link href={href} {...props} />;
}

function Div({ className, node: _, ...props }: Props<'div'> & Record<string, unknown>) {
  if (className === 'callout') {
    return (
      <Callout type={props['data-type'] as string} title={props['data-title'] as string}>
        {props.children}
      </Callout>
    );
  }
  if (className === 'phones') {
    return <div className="not-prose my-8 flex flex-wrap gap-6">{props.children}</div>;
  }
  return <div className={className} {...props} />;
}

function Figure({ node: _, ...props }: Props<'figure'>) {
  return <figure className="m-0 w-56 max-w-full" {...props} />;
}

function Img({ node: _, alt = '', ...props }: Props<'img'>) {
  return (
    <img
      alt={alt}
      loading="lazy"
      className="w-full rounded-[1.75rem] shadow-lg ring-1 shadow-zinc-900/10 ring-zinc-900/10 dark:shadow-black/40 dark:ring-white/10"
      {...props}
    />
  );
}

function Figcaption({ node: _, ...props }: Props<'figcaption'>) {
  return <figcaption className="mt-3 text-xs/5 text-zinc-500 dark:text-zinc-400" {...props} />;
}

function Table({ node: _, ...props }: Props<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  );
}

function H2({ node: _, id = '', ...props }: Props<'h2'>) {
  return <Heading level={2} id={id} {...props} />;
}

function H3({ node: _, id = '', ...props }: Props<'h3'>) {
  return <Heading level={3} id={id} {...props} />;
}

export function Markdown({ tree }: { tree: Root }) {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    passNode: false,
    components: {
      a: Anchor,
      div: Div,
      figure: Figure,
      figcaption: Figcaption,
      img: Img,
      table: Table,
      h2: H2,
      h3: H3,
    },
  });
}
